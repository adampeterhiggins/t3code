import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useCallback, useMemo, useState } from "react";

import { threadListEnvironmentsAtom } from "../../state/server";
import {
  availableThreadListPages,
  collectThreadGroupNames,
  DEFAULT_THREAD_LIST_PAGES,
  resolveThreadListPages,
  threadListGroupPage,
  toggleThreadListPage,
  type ThreadListPage,
} from "./threadListV2";
import { useThreadGroups } from "./use-thread-groups";

/**
 * The Show picker for the compact Home list and iPad sidebar: which pages are
 * picked, which exist, and the groups (registered or carried by a thread)
 * offered by Move to group. Kept in memory, like the project filter.
 */
export function useThreadListPages(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const { hidingEnvironmentIds, groupEnvironmentIds } = useAtomValue(threadListEnvironmentsAtom);
  const { groups } = useThreadGroups();
  const groupNames = useMemo(
    () => collectThreadGroupNames(threads, groupEnvironmentIds, Object.keys(groups)),
    [threads, groupEnvironmentIds, groups],
  );
  const availablePages = useMemo(
    () => availableThreadListPages({ hidingSupported: hidingEnvironmentIds.size > 0, groupNames }),
    [hidingEnvironmentIds, groupNames],
  );
  const [pickedPages, setPickedPages] = useState(DEFAULT_THREAD_LIST_PAGES);
  const pages = useMemo(
    () => resolveThreadListPages(pickedPages, availablePages),
    [pickedPages, availablePages],
  );
  const togglePage = useCallback(
    (page: ThreadListPage) =>
      setPickedPages((current) =>
        toggleThreadListPage(resolveThreadListPages(current, availablePages), page, availablePages),
      ),
    [availablePages],
  );
  /** Keeps a renamed group picked; `to` null drops a deleted one. */
  const renameGroupPage = useCallback((from: string, to: string | null) => {
    const fromPage = threadListGroupPage(from);
    setPickedPages((current) => {
      if (!current.includes(fromPage)) return current;
      const next = current.flatMap((page) =>
        page !== fromPage ? [page] : to === null ? [] : [threadListGroupPage(to)],
      );
      return next.length > 0 ? next : DEFAULT_THREAD_LIST_PAGES;
    });
  }, []);
  return {
    pages,
    availablePages,
    groups,
    groupNames,
    groupsSupported: groupEnvironmentIds.size > 0,
    togglePage,
    renameGroupPage,
  } as const;
}
