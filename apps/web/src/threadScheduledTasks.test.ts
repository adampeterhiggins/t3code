import {
  type OrchestrationV2ProjectedTurnItem,
  ProjectId,
  ProviderInstanceId,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadScheduledTasks } from "./threadScheduledTasks";

const THREAD = ThreadId.make("thread-eod");
const OTHER_THREAD = ThreadId.make("thread-other");

function task(
  id: string,
  overrides: Partial<Pick<ScheduledTask, "threadId" | "schedule">> = {},
): ScheduledTask {
  return {
    id: ScheduledTaskId.make(id),
    title: id,
    prompt: "Write the brief.",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "16:57", weekdays: [1, 2, 3, 4, 5] },
    projectId: ProjectId.make("project"),
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
    ...overrides,
  };
}

function userMessage(scheduledTaskId?: string): OrchestrationV2ProjectedTurnItem {
  return {
    item: {
      type: "user_message",
      ...(scheduledTaskId === undefined
        ? {}
        : { scheduledTaskId: ScheduledTaskId.make(scheduledTaskId) }),
    },
  } as OrchestrationV2ProjectedTurnItem;
}

const ids = (tasks: ReadonlyArray<ScheduledTask>) => tasks.map((entry) => entry.id);

describe("resolveThreadScheduledTasks", () => {
  it("finds tasks bound to the thread and tasks whose runs posted into it", () => {
    const tasks = [
      task("bound", { threadId: THREAD }),
      task("posted"),
      task("elsewhere", { threadId: OTHER_THREAD }),
      task("unrelated"),
    ];
    expect(
      ids(resolveThreadScheduledTasks(tasks, THREAD, [userMessage("posted"), userMessage()])),
    ).toEqual(["bound", "posted"]);
  });

  it("lists a task once when it is bound and also posted", () => {
    const tasks = [task("bound", { threadId: THREAD })];
    expect(
      ids(resolveThreadScheduledTasks(tasks, THREAD, [userMessage("bound"), userMessage("bound")])),
    ).toEqual(["bound"]);
  });

  it("leaves out webhook tasks, which cannot run without a request", () => {
    const tasks = [
      task("hook", {
        threadId: THREAD,
        schedule: { type: "webhook", signature: null, maxDeliveryAgeMinutes: null },
      }),
      task("interval", { threadId: THREAD, schedule: { type: "interval", everyMs: 60_000 } }),
    ];
    expect(ids(resolveThreadScheduledTasks(tasks, THREAD, [userMessage("hook")]))).toEqual([
      "interval",
    ]);
  });

  it("finds nothing for a thread without scheduled tasks", () => {
    expect(resolveThreadScheduledTasks([task("unrelated")], THREAD, [userMessage()])).toEqual([]);
  });
});
