import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import {
  USAGE_LIMIT_RESUME_PROMPT,
  deriveUsageLimitRecovery,
} from "@t3tools/shared/usageLimitRecovery";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const STOPPED_AT = "2026-01-01T00:00:00.000Z";
const NOW = "2026-01-01T00:05:00.000Z";
const RESET_AT = "2026-01-01T03:00:00.000Z";
const threadId = ThreadId.make("thread-1");
const errorActivityId = EventId.make("usage-limit-error");

const usageLimitError: OrchestrationThreadActivity = {
  id: errorActivityId,
  kind: "runtime.error",
  summary: "Runtime error",
  tone: "error",
  turnId: TurnId.make("turn-1"),
  createdAt: STOPPED_AT,
  payload: { message: "Codex usage limit reached.", usageLimit: { resetsAt: RESET_AT } },
};

function makeSession(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId,
    status,
    providerName: "codex",
    runtimeMode: "approval-required",
    activeTurnId: status === "running" ? TurnId.make("turn-2") : null,
    lastError: status === "error" ? "Codex usage limit reached." : null,
    updatedAt: STOPPED_AT,
  };
}

function makeReadModel(session: OrchestrationSession): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "approval-required",
        interactionMode: "plan",
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
        activities: [usageLimitError],
        checkpoints: [],
        session,
      },
    ],
    updatedAt: STOPPED_AT,
  };
}

function resume(
  commandId: string,
  action: "now" | "schedule" | "cancel",
  resumeAt?: string,
): OrchestrationCommand {
  return {
    type: "thread.usage-limit.resume",
    commandId: CommandId.make(commandId),
    threadId,
    errorActivityId,
    action,
    ...(resumeAt ? { resumeAt } : {}),
    createdAt: NOW,
  };
}

const apply = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({ command, readModel });
    const events = Array.isArray(result) ? result : [result];
    let next = readModel;
    for (const [index, event] of events.entries()) {
      next = yield* projectEvent(next, {
        ...event,
        sequence: readModel.snapshotSequence + index + 1,
      });
    }
    return { events, readModel: next };
  });

const recoveryOf = (readModel: OrchestrationReadModel) => {
  const thread = readModel.threads[0]!;
  return deriveUsageLimitRecovery({
    activities: thread.activities,
    latestUserMessageAt:
      thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null,
    sessionStatus: thread.session?.status ?? null,
  });
};

it.layer(NodeServices.layer)("usage-limit resume decider", (it) => {
  it.effect("arms an automatic resume for the stop, then disarms it", () =>
    Effect.gen(function* () {
      const stopped = makeReadModel(makeSession("error"));
      expect(recoveryOf(stopped)).toMatchObject({ resetsAt: RESET_AT, scheduledResumeAt: null });

      const armed = yield* apply(stopped, resume("arm-1", "schedule", RESET_AT));
      expect(armed.events.map((event) => event.type)).toEqual(["thread.activity-appended"]);
      expect(recoveryOf(armed.readModel)).toMatchObject({
        errorActivityId,
        scheduledResumeAt: RESET_AT,
      });

      const cancelled = yield* apply(armed.readModel, resume("cancel-1", "cancel"));
      expect(recoveryOf(cancelled.readModel)).toMatchObject({
        errorActivityId,
        scheduledResumeAt: null,
      });
    }),
  );

  it.effect("resumes the same session with a continue message", () =>
    Effect.gen(function* () {
      const { events, readModel } = yield* apply(
        makeReadModel(makeSession("error")),
        resume("now-1", "now"),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(events[1]?.payload).toMatchObject({
        threadId,
        runtimeMode: "approval-required",
        interactionMode: "plan",
      });
      expect(readModel.threads[0]?.messages.at(-1)).toMatchObject({
        role: "user",
        text: USAGE_LIMIT_RESUME_PROMPT,
      });
      // The continue message moves the thread past the stop.
      expect(recoveryOf(readModel)).toBeNull();
    }),
  );

  it.effect("refuses to resume over a turn that is already running", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: resume("now-2", "now"),
        readModel: makeReadModel(makeSession("running")),
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
    }),
  );

  it.effect("rejects a schedule without a resume time", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: resume("arm-2", "schedule"),
        readModel: makeReadModel(makeSession("error")),
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
    }),
  );
});
