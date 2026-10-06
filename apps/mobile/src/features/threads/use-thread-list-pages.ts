import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useCallback, useMemo, useState } from "react";

import { threadListEnvironmentsAtom } from "../../state/server";
import {
  availableThreadListPages,
  collectThreadGroupNames,
  DEFAULT_THREAD_LIST_PAGES,
  resolveThreadListPages,
  toggleThreadListPage,
  type ThreadListPage,
} from "./threadListV2";

/**
 * The Show picker for the compact Home list and iPad sidebar: which pages are
 * picked, which exist, and the group names offered by Move to group. Kept in
 * memory, like the project filter.
 */
export function useThreadListPages(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const { hidingEnvironmentIds, groupEnvironmentIds } = useAtomValue(threadListEnvironmentsAtom);
  const groupNames = useMemo(
    () => collectThreadGroupNames(threads, groupEnvironmentIds),
    [threads, groupEnvironmentIds],
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
  return { pages, availablePages, groupNames, togglePage } as const;
}
