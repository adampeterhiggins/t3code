import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ThreadId,
  ThreadTabMembership,
} from "@t3tools/contracts";

/**
 * Where a citation from the comment panel goes: its own composer, a new thread, a new tab in
 * `threadId`'s tab group, or another thread (any tab is a thread).
 */
export type CitationDestination =
  | { readonly kind: "here" }
  | {
      readonly kind: "new-thread";
      readonly projectId: ProjectId;
      readonly modelSelection: ModelSelection;
    }
  | {
      readonly kind: "new-tab";
      readonly threadId: ThreadId;
      /** The group's title, for labels and toasts. */
      readonly title: string;
      readonly modelSelection: ModelSelection;
    }
  | { readonly kind: "thread"; readonly threadId: ThreadId; readonly title: string };

/** What the panel's split button does with the citation at a destination other than here. */
export type CitationDestinationAction = "send" | "save" | "draft";

export const CITATION_DESTINATION_HERE: CitationDestination = { kind: "here" };

/** A thread as the destination picker shows it: its tab group, or the thread alone. */
export interface CitationDestinationGroup {
  readonly key: ThreadId;
  readonly title: string;
  readonly projectId: ProjectId;
  /** In tab order; a thread outside any group is its own single tab. */
  readonly tabs: ReadonlyArray<EnvironmentThreadShell>;
  readonly current: boolean;
}

/**
 * The source environment's live threads, gathered into their tab groups: the cited thread's
 * group first, then groups with a running tab, then the most recently updated.
 */
export function groupCitationDestinations(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Null when the environment does not serve tabs, so every thread stands alone. */
  readonly memberships: ReadonlyArray<ThreadTabMembership> | null;
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId;
}): CitationDestinationGroup[] {
  const live = new Map(
    input.threads
      .filter(
        (thread) =>
          thread.environmentId === input.environmentId &&
          thread.archivedAt === null &&
          (thread.hiddenAt ?? null) === null,
      )
      .map((thread) => [thread.id, thread]),
  );
  const groups = new Map<ThreadId, { name: string | null; tabs: EnvironmentThreadShell[] }>();
  const grouped = new Set<ThreadId>();
  for (const row of input.memberships ?? []) {
    const thread = live.get(row.threadId);
    if (!thread) continue;
    const group = groups.get(row.groupId) ?? { name: row.groupName ?? null, tabs: [] };
    group.tabs.push(thread);
    groups.set(row.groupId, group);
    grouped.add(thread.id);
  }
  for (const thread of live.values()) {
    if (!grouped.has(thread.id)) groups.set(thread.id, { name: null, tabs: [thread] });
  }
  const running = (group: CitationDestinationGroup) =>
    Number(group.tabs.some((tab) => threadRuntimeIsActive(tab.runtime)));
  const updatedAt = (group: CitationDestinationGroup) =>
    group.tabs.reduce((latest, tab) => (tab.updatedAt > latest ? tab.updatedAt : latest), "");
  return [...groups.entries()]
    .flatMap(([key, { name, tabs }]) => {
      const [first] = tabs;
      if (!first) return [];
      return [
        {
          key,
          title: name ?? first.title,
          projectId: first.projectId,
          tabs,
          current: tabs.some((tab) => tab.id === input.currentThreadId),
        },
      ];
    })
    .toSorted(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        running(b) - running(a) ||
        updatedAt(b).localeCompare(updatedAt(a)),
    );
}

/** Tabs whose own, group, or project title contains the query, in the groups' order. */
export function searchCitationDestinationTabs(
  groups: ReadonlyArray<CitationDestinationGroup>,
  projectTitles: ReadonlyMap<ProjectId, string>,
  query: string,
): Array<{ readonly group: CitationDestinationGroup; readonly tab: EnvironmentThreadShell }> {
  const search = query.trim().toLocaleLowerCase();
  return groups.flatMap((group) =>
    group.tabs
      .filter((tab) =>
        `${group.title} ${tab.title} ${projectTitles.get(group.projectId) ?? ""}`
          .toLocaleLowerCase()
          .includes(search),
      )
      .map((tab) => ({ group, tab })),
  );
}

/** Adds a citation to the end of another composer's prompt, keeping a space between them. */
export function appendCitationToPrompt(prompt: string, citationText: string): string {
  if (prompt.trim().length === 0) return `${citationText} `;
  return `${prompt}${/\s$/.test(prompt) ? "" : " "}${citationText} `;
}
