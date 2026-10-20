import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { openCommandPalette } from "../commandPaletteBus";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readThreadVisibleTurnItems } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { resolveThreadScheduledTasks } from "../threadScheduledTasks";

export function useRunScheduledTask() {
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "scheduled task run now",
    reportFailure: false,
  });
  return async (environmentId: EnvironmentId, task: ScheduledTask) => {
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    const result = await runNow({ environmentId, input: { id: task.id } });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Scheduled task started",
        description: task.title,
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not run ${task.title}`,
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
}

/**
 * Runs the active thread's scheduled task: one task starts at once, several
 * open the command palette to pick. Lists tasks on demand so an open thread
 * does not hold a live task subscription just for this shortcut.
 */
export function useRunThreadScheduledTask() {
  const listTasks = useAtomQueryRunner(serverEnvironment.scheduledTasks, {
    label: "thread scheduled tasks",
    refresh: true,
  });
  const runTask = useRunScheduledTask();
  return async (threadRef: ScopedThreadRef) => {
    const result = await listTasks({ environmentId: threadRef.environmentId, input: {} });
    if (result._tag !== "Success") return;
    const tasks = resolveThreadScheduledTasks(
      result.value.tasks,
      threadRef.threadId,
      readThreadVisibleTurnItems(threadRef),
    );
    if (tasks.length === 0) {
      toastManager.add({ type: "info", title: "No scheduled tasks run in this thread" });
    } else if (tasks.length === 1) {
      await runTask(threadRef.environmentId, tasks[0]!);
    } else {
      openCommandPalette({ open: "run-scheduled-task" });
    }
  };
}
