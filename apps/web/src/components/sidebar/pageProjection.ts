import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sortThreadsForSidebar } from "../Sidebar.logic";
import { sidebarPagesAllowDragging, type SidebarPage } from "./organization.logic";

const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];
const sidebarThreadKey = (thread: EnvironmentThreadShell) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export function groupSidebarThreadsByName(
  groupedThreads: readonly EnvironmentThreadShell[],
  shownGroupThreads: readonly { thread: EnvironmentThreadShell; page: SidebarPage }[],
  sidebarPages: readonly SidebarPage[],
) {
  const byName = new Map<string, EnvironmentThreadShell[]>();
  const add = (thread: EnvironmentThreadShell) => {
    const name = thread.groupName!;
    byName.set(name, [...(byName.get(name) ?? []), thread]);
  };
  for (const thread of groupedThreads) add(thread);
  let mixed = false;
  for (const { thread, page } of shownGroupThreads) {
    if (sidebarPages.includes(page)) continue;
    add(thread);
    mixed = true;
  }
  if (!mixed) return byName;
  return new Map([...byName].map(([name, list]) => [name, sortThreadsForSidebar(list)]));
}

export function projectSidebarPages(input: {
  sidebarPages: readonly SidebarPage[];
  collapsedPages: ReadonlySet<string>;
  sidebarRouteThreadKey: string | null;
  groupedThreadsByName: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  automationThreads: readonly EnvironmentThreadShell[];
  visibleSettledThreads: readonly EnvironmentThreadShell[];
  snoozedThreads: readonly EnvironmentThreadShell[];
  hiddenThreads: readonly EnvironmentThreadShell[];
}) {
  const {
    sidebarPages,
    collapsedPages,
    sidebarRouteThreadKey,
    groupedThreadsByName,
    automationThreads,
    visibleSettledThreads,
    snoozedThreads,
    hiddenThreads,
  } = input;
  // The rows a picked page lists. A folded page keeps only the open thread, as the
  // Working shelf does, so the route's row never vanishes behind its header.
  const pageRows = (page: SidebarPage, list: readonly EnvironmentThreadShell[]) => {
    if (!sidebarPages.includes(page)) return EMPTY_THREADS;
    if (!collapsedPages.has(page)) return list;
    const routeThread = list.find((thread) => sidebarThreadKey(thread) === sidebarRouteThreadKey);
    return routeThread === undefined ? EMPTY_THREADS : [routeThread];
  };
  // Picked groups in list order, each with the rows the current project scope leaves it.
  const visibleGroups = sidebarPages.flatMap((page) => {
    if (!page.startsWith("group:")) return [];
    const name = page.slice("group:".length);
    return [
      {
        name,
        threads: pageRows(page, groupedThreadsByName.get(name) ?? EMPTY_THREADS),
      },
    ];
  });
  const showsPage = (page: SidebarPage) => sidebarPages.includes(page);
  const showsThreads = showsPage("threads");
  // Dragging moves rows between pinned and active only, so it stays off while
  // pages it cannot place share the list.
  const threadsOnly = sidebarPagesAllowDragging(sidebarPages);
  const visibleAutomationThreads = pageRows("automations", automationThreads);
  const renderedSettledThreads = pageRows("settled", visibleSettledThreads);
  const visibleSnoozedThreads = pageRows("snoozed", snoozedThreads);
  const visibleHiddenThreads = pageRows("hidden", hiddenThreads);
  return {
    visibleGroups,
    showsPage,
    showsThreads,
    threadsOnly,
    visibleAutomationThreads,
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleHiddenThreads,
  };
}
