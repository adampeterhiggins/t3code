import type {
  OrchestrationV2ProjectedTurnItem,
  ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";

/**
 * The scheduled tasks a thread can run now: those bound to it and those whose
 * runs posted into it. Webhook tasks are left out because they need a request
 * to run, so the server refuses to run them now.
 */
export function resolveThreadScheduledTasks(
  tasks: ReadonlyArray<ScheduledTask>,
  threadId: ThreadId,
  turnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlyArray<ScheduledTask> {
  const postedTaskIds = new Set<ScheduledTaskId>();
  for (const { item } of turnItems) {
    if (item.type === "user_message" && item.scheduledTaskId !== undefined) {
      postedTaskIds.add(item.scheduledTaskId);
    }
  }
  return tasks.filter(
    (task) =>
      task.schedule.type !== "webhook" &&
      (task.threadId === threadId || postedTaskIds.has(task.id)),
  );
}
