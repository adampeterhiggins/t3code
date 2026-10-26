import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { useThreadGroups } from "../../hooks/useThreadGroups";
import { requestThreadGroup } from "../ThreadGroupDialog";
import { sidebarGroupPage } from "./organization.logic";

type UpdatePages = (update: (pages: readonly string[]) => readonly string[]) => void;

export function createSidebarGroupActions(input: {
  threads: readonly EnvironmentThreadShell[];
  threadGroups: ReturnType<typeof useThreadGroups>["groups"];
  saveGroup: ReturnType<typeof useThreadGroups>["saveGroup"];
  deleteGroup: ReturnType<typeof useThreadGroups>["deleteGroup"];
  setSidebarPages: UpdatePages;
  setCollapsedPages: UpdatePages;
  attemptSetGroup: (threadRef: ScopedThreadRef, groupName: string | null) => void;
}) {
  const {
    threads,
    threadGroups,
    saveGroup,
    deleteGroup,
    setSidebarPages,
    setCollapsedPages,
    attemptSetGroup,
  } = input;
  /**
   * Renames, restyles or deletes a group. Renaming moves each of its threads and keeps it picked;
   * deleting returns its threads to the live list and drops it from Show.
   */
  const editThreadGroup = (name: string) => {
    void (async () => {
      const result = await requestThreadGroup({
        name,
        group: threadGroups[name] ?? {},
      });
      if (result === null) return;
      const nextName = result === "delete" ? null : result.name;
      if (result === "delete") deleteGroup(name);
      else saveGroup({ from: name, ...result });
      if (nextName === name) return;
      for (const thread of threads) {
        if (thread.groupName === name) {
          attemptSetGroup(scopeThreadRef(thread.environmentId, thread.id), nextName);
        }
      }
      const renamePage = (pages: readonly string[]) =>
        nextName === null
          ? pages.filter((page) => page !== sidebarGroupPage(name))
          : pages.map((page) =>
              page === sidebarGroupPage(name) ? sidebarGroupPage(nextName) : page,
            );
      setSidebarPages(renamePage);
      setCollapsedPages(renamePage);
    })();
  };
  /** Creates an empty group from the filter menu and shows it. */
  const createThreadGroup = () => {
    void (async () => {
      const result = await requestThreadGroup();
      if (result === null || result === "delete") return;
      saveGroup(result);
      setSidebarPages((pages) => [...pages, sidebarGroupPage(result.name)]);
    })();
  };
  return { editThreadGroup, createThreadGroup };
}
