import {
  CommandId,
  EventId,
  IsoDateTime,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import {
  USAGE_LIMIT_RESUME_CANCELLED_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_KIND,
  deriveUsageLimitRecovery,
} from "@t3tools/shared/usageLimitRecovery";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Resumes threads whose user armed "Resume when available" after a usage-limit
 * stop. The arming is a durable activity, so the server keeps the promise with
 * no client connected and across restarts; this reactor only holds the timers.
 * Each timer re-reads the thread when it fires and resumes only if that exact
 * schedule is still the open one, so cancels, newer messages, and re-arms need
 * no bookkeeping here beyond replacing the thread's timer.
 */
export class UsageLimitResumeReactor extends Context.Service<
  UsageLimitResumeReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration/UsageLimitResumeReactor") {}

const ScheduledResumePayload = Schema.Struct({
  threadId: ThreadId,
  errorActivityId: EventId,
  resumeAt: IsoDateTime,
});
const decodeScheduledResume = Schema.decodeUnknownOption(ScheduledResumePayload);
type ScheduledResume = typeof ScheduledResumePayload.Type;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const resumeIfStillArmed = Effect.fn("UsageLimitResumeReactor.resumeIfStillArmed")(
    function* (scheduled: ScheduledResume) {
      // The shell answers the common stale case (a later message) without
      // hydrating the thread's history.
      const shell = yield* snapshots.getThreadShellById(scheduled.threadId);
      if (Option.isNone(shell) || shell.value.archivedAt !== null) return;
      const detail = yield* snapshots.getThreadDetailById(scheduled.threadId);
      if (Option.isNone(detail)) return;
      const recovery = deriveUsageLimitRecovery({
        activities: detail.value.activities,
        latestUserMessageAt: shell.value.latestUserMessageAt,
        sessionStatus: shell.value.session?.status ?? null,
      });
      if (
        recovery?.errorActivityId !== scheduled.errorActivityId ||
        recovery.scheduledResumeAt !== scheduled.resumeAt
      ) {
        return;
      }
      const uuid = yield* crypto.randomUUIDv4;
      yield* engine.dispatch({
        type: "thread.usage-limit.resume",
        commandId: CommandId.make(`server:usage-limit-resume:${uuid}`),
        threadId: scheduled.threadId,
        errorActivityId: scheduled.errorActivityId,
        action: "now",
        createdAt: DateTime.formatIso(yield* DateTime.now),
      });
    },
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterruptsOnly(cause),
      (cause) => Effect.logWarning("usage-limit resume skipped", { cause: Cause.pretty(cause) }),
    ),
  );

  const start: UsageLimitResumeReactor["Service"]["start"] = Effect.fn(
    "UsageLimitResumeReactor.start",
  )(function* () {
    const timers = yield* FiberMap.make<ThreadId>();
    // One timer per thread: a re-arm replaces the earlier one.
    const arm = (scheduled: ScheduledResume) =>
      Effect.gen(function* () {
        const waitMs = Date.parse(scheduled.resumeAt) - (yield* Clock.currentTimeMillis);
        yield* FiberMap.run(
          timers,
          scheduled.threadId,
        )(
          Effect.sleep(Duration.millis(Math.max(0, waitMs))).pipe(
            Effect.andThen(resumeIfStillArmed(scheduled)),
          ),
        );
      });
    const scheduledFrom = (activity: OrchestrationThreadActivity) =>
      activity.kind === USAGE_LIMIT_RESUME_SCHEDULED_KIND
        ? decodeScheduledResume(activity.payload)
        : Option.none();

    const processEvent = (event: OrchestrationEvent) => {
      if (event.type !== "thread.activity-appended") return Effect.void;
      const { activity, threadId } = event.payload;
      if (activity.kind === USAGE_LIMIT_RESUME_CANCELLED_KIND) {
        return FiberMap.remove(timers, threadId);
      }
      const scheduled = scheduledFrom(activity);
      return Option.isSome(scheduled) ? arm(scheduled.value) : Effect.void;
    };

    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(Stream.runForEach(events, processEvent));
    // Timers live in memory; re-arm the ones a previous process left. Each
    // re-checks on firing, so stale schedules resolve to no-ops.
    yield* forkParked(
      snapshots.listActivitiesByKind(USAGE_LIMIT_RESUME_SCHEDULED_KIND).pipe(
        Effect.flatMap((activities) =>
          Effect.forEach(activities, (activity) => {
            const scheduled = scheduledFrom(activity);
            return Option.isSome(scheduled) ? arm(scheduled.value) : Effect.void;
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("could not restore scheduled usage-limit resumes", {
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );
  });

  return { start } satisfies UsageLimitResumeReactor["Service"];
});

export const layer = Layer.effect(UsageLimitResumeReactor, make);
