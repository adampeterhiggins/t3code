import type { ProjectId, ScheduledTask } from "@t3tools/contracts";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";

type AutomationCandidate = Pick<
  ScheduledTask,
  "projectId" | "title" | "prompt" | "schedule" | "lastRunAt" | "updatedAt"
>;

/** Why Run now cannot start a task, or null when it can. */
export function automationRunBlocker(
  task: Pick<ScheduledTask, "schedule" | "lastRunStatus">,
): string | null {
  // The server refuses a webhook task: its prompt is rendered from the request that triggers it.
  if (task.schedule.type === "webhook") return "Runs when its webhook URL is called";
  if (task.lastRunStatus === "running") return "Already running";
  return null;
}

/**
 * The project's tasks matching the search, webhook tasks (which cannot be run from here) last and
 * the most recently run (or, if never run, edited) first otherwise: picking a task here runs it,
 * so the ones in regular use lead. Recency also keeps rows still while the list is open, where
 * next-run time would reshuffle them as each interval ticks over.
 */
export function automationsForPicker<T extends AutomationCandidate>(
  tasks: ReadonlyArray<T>,
  projectId: ProjectId,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  const recency = (task: T) => task.lastRunAt ?? task.updatedAt;
  return (
    tasks
      .filter(
        (task) =>
          task.projectId === projectId &&
          (needle.length === 0 ||
            task.title.toLowerCase().includes(needle) ||
            task.prompt.toLowerCase().includes(needle)),
      )
      // `filter` already copied, so sorting in place is safe; Hermes lacks `toSorted`.
      .sort(
        (a, b) =>
          Number(a.schedule.type === "webhook") - Number(b.schedule.type === "webhook") ||
          recency(b).localeCompare(recency(a)),
      )
  );
}

/**
 * A composer draft's text as a task prompt. A task runs a text prompt, so inline context chips
 * become their labels and anything held beside the text is left out; the note says which.
 */
export function scheduledTaskPromptFromComposer(
  prompt: string,
  sideContextCount: number,
): { readonly prompt: string; readonly note: string | null } {
  let chipCount = 0;
  const text = replaceComposerContextReferences(prompt, (occurrence) => {
    chipCount += 1;
    return occurrence.label;
  }).trim();
  const note =
    sideContextCount > 0
      ? `Tasks run a text prompt, so the draft's attachments and context were left out${
          chipCount > 0 ? " and its context chips kept as plain labels" : ""
        }.`
      : chipCount > 0
        ? "Tasks run a text prompt, so the draft's context chips were kept as plain labels."
        : null;
  return { prompt: text, note };
}
