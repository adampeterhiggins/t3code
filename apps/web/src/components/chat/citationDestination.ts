import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";

/** Where a citation from the comment panel goes: its own composer, a new thread, or another thread. */
export type CitationDestination =
  | { readonly kind: "here" }
  | {
      readonly kind: "new-thread";
      readonly projectId: ProjectId;
      readonly modelSelection: ModelSelection;
    }
  | { readonly kind: "thread"; readonly threadId: ThreadId; readonly title: string };

/** What the panel's split button does with the citation at a destination other than here. */
export type CitationDestinationAction = "send" | "save" | "draft";

export const CITATION_DESTINATION_HERE: CitationDestination = { kind: "here" };

interface CitationDestinationThread {
  readonly thread: EnvironmentThreadShell;
  readonly projectTitle: string | null;
  readonly running: boolean;
}

/**
 * Threads the comment panel offers: the source environment's unarchived threads other than the
 * one being cited from, running ones first, then the most recently updated.
 */
export function rankCitationDestinationThreads(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projectTitles: ReadonlyMap<ProjectId, string>;
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId;
  readonly query: string;
}): CitationDestinationThread[] {
  const search = input.query.trim().toLocaleLowerCase();
  return input.threads
    .filter(
      (thread) =>
        thread.environmentId === input.environmentId &&
        thread.id !== input.currentThreadId &&
        thread.archivedAt === null &&
        (thread.hiddenAt ?? null) === null,
    )
    .map((thread) => ({
      thread,
      projectTitle: input.projectTitles.get(thread.projectId) ?? null,
      running: threadRuntimeIsActive(thread.runtime),
    }))
    .filter(
      ({ thread, projectTitle }) =>
        search.length === 0 ||
        `${thread.title} ${projectTitle ?? ""}`.toLocaleLowerCase().includes(search),
    )
    .toSorted(
      (a, b) =>
        Number(b.running) - Number(a.running) ||
        b.thread.updatedAt.localeCompare(a.thread.updatedAt),
    );
}

/** Adds a citation to the end of another composer's prompt, keeping a space between them. */
export function appendCitationToPrompt(prompt: string, citationText: string): string {
  if (prompt.trim().length === 0) return `${citationText} `;
  return `${prompt}${/\s$/.test(prompt) ? "" : " "}${citationText} `;
}
