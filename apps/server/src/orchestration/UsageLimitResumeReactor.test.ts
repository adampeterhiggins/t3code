import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { USAGE_LIMIT_RESUME_SCHEDULED_KIND } from "@t3tools/shared/usageLimitRecovery";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import * as UsageLimitResumeReactor from "./UsageLimitResumeReactor.ts";

const STOPPED_AT = "2026-01-01T00:00:00.000Z";
const RESUME_AT = "2026-01-01T03:01:00.000Z";
const threadId = ThreadId.make("thread-1");
const errorActivityId = EventId.make("usage-limit-error");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const usageLimitError: OrchestrationThreadActivity = {
  id: errorActivityId,
  kind: "runtime.error",
  summary: "Runtime error",
  tone: "error",
  turnId: TurnId.make("turn-1"),
  createdAt: STOPPED_AT,
  payload: { message: "Codex usage limit reached.", usageLimit: { resetsAt: RESUME_AT } },
};

const scheduled: OrchestrationThreadActivity = {
  id: EventId.make("usage-limit-resume:arm-1"),
  kind: USAGE_LIMIT_RESUME_SCHEDULED_KIND,
  summary: "Resume scheduled",
  tone: "info",
  turnId: null,
  createdAt: "2026-01-01T00:01:00.000Z",
  payload: { threadId, errorActivityId, resumeAt: RESUME_AT },
};

const thread: OrchestrationThread = {
  id: threadId,
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  pullRequests: [],
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: STOPPED_AT,
  updatedAt: STOPPED_AT,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [usageLimitError, scheduled],
  checkpoints: [],
  session: {
    threadId,
    status: "error",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: "Codex usage limit reached.",
    updatedAt: STOPPED_AT,
  },
};

const makeFixture = (restored: ReadonlyArray<OrchestrationThreadActivity>) =>
  Effect.gen(function* () {
    const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
    const dispatched = yield* Queue.unbounded<OrchestrationCommand>();
    const current = yield* Ref.make(thread);
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        listActivitiesByKind: (kind) =>
          Effect.succeed(kind === USAGE_LIMIT_RESUME_SCHEDULED_KIND ? restored : []),
        getThreadShellById: () =>
          Ref.get(current).pipe(
            Effect.map((value) =>
              Option.some({
                ...value,
                latestUserMessageAt: null,
                hasPendingApprovals: false,
                hasPendingUserInput: false,
                hasActionableProposedPlan: false,
              }),
            ),
          ),
        getThreadDetailById: () => Ref.get(current).pipe(Effect.map(Option.some)),
      }),
      Layer.mock(OrchestrationEngineService)({
        readEvents: () => Stream.empty,
        dispatch: (command) => Queue.offer(dispatched, command).pipe(Effect.as({ sequence: 1 })),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: PubSub.subscribe(domainEvents).pipe(
          Effect.map((subscription) => Stream.fromSubscription(subscription)),
        ),
        latestSequence: Effect.succeed(0),
      }),
      Layer.succeed(Crypto.Crypto, testCrypto),
    );
    return {
      dispatched,
      publish: (activity: OrchestrationThreadActivity) =>
        PubSub.publish(domainEvents, {
          sequence: 2,
          eventId: EventId.make(`event:${activity.id}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: activity.createdAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.activity-appended",
          payload: { threadId, activity },
        }),
      layer: UsageLimitResumeReactor.layer.pipe(Layer.provide(dependencies)),
    };
  });

describe("UsageLimitResumeReactor", () => {
  it.effect("resumes an armed thread once its reset time arrives", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(scheduled.createdAt));
        const fixture = yield* makeFixture([]);
        yield* Effect.gen(function* () {
          const reactor = yield* UsageLimitResumeReactor.UsageLimitResumeReactor;
          yield* reactor.start();
          yield* fixture.publish(scheduled);
          yield* TestClock.adjust("3 hours");
          const command = yield* Queue.take(fixture.dispatched);
          assert.deepInclude(command, {
            type: "thread.usage-limit.resume",
            threadId,
            errorActivityId,
            action: "now",
          });
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("re-arms a schedule a previous server process left behind", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The server was down past the reset: resume as soon as it is back.
        yield* TestClock.setTime(Date.parse("2026-01-01T05:00:00.000Z"));
        const fixture = yield* makeFixture([scheduled]);
        yield* Effect.gen(function* () {
          const reactor = yield* UsageLimitResumeReactor.UsageLimitResumeReactor;
          yield* reactor.start();
          const command = yield* Queue.take(fixture.dispatched);
          assert.deepInclude(command, { type: "thread.usage-limit.resume", action: "now" });
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );
});
