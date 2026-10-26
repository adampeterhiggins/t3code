import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadGroupsShownInThreads } from "@t3tools/contracts/settings";
import { useThreadGroups } from "../../hooks/useThreadGroups";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { collectThreadGroupNames } from "../threadActionMenu.logic";
import { SidebarPagesSchema } from "./organization.logic";
import { availableSidebarPages, resolveSidebarPages, type SidebarPage } from "./organization.logic";

const SIDEBAR_PAGES_KEY = "t3code:sidebar:pages";
const DEFAULT_SIDEBAR_PAGES: readonly string[] = ["threads", "automations"];
const SIDEBAR_COLLAPSED_PAGES_KEY = "t3code:sidebar:collapsed-pages";
const NO_COLLAPSED_PAGES: readonly string[] = [];

export function useSidebarOrganization(threads: readonly EnvironmentThreadShell[]) {
  const { groups: threadGroups, saveGroup, deleteGroup } = useThreadGroups();
  const groupsShownInThreads = threadGroupsShownInThreads(threadGroups);
  const [storedSidebarPages, setSidebarPages] = useLocalStorage(
    SIDEBAR_PAGES_KEY,
    DEFAULT_SIDEBAR_PAGES,
    SidebarPagesSchema,
  );
  const threadGroupNames = collectThreadGroupNames(threads, Object.keys(threadGroups));
  const availablePages = availableSidebarPages(threadGroupNames);
  const sidebarPages = resolveSidebarPages(storedSidebarPages, threadGroupNames);
  const [storedCollapsedPages, setCollapsedPages] = useLocalStorage(
    SIDEBAR_COLLAPSED_PAGES_KEY,
    NO_COLLAPSED_PAGES,
    SidebarPagesSchema,
  );
  const collapsedPages = new Set(storedCollapsedPages);
  const togglePageCollapsed = (page: SidebarPage) =>
    setCollapsedPages((pages) =>
      pages.includes(page) ? pages.filter((entry) => entry !== page) : [...pages, page],
    );
  return {
    threadGroups,
    saveGroup,
    deleteGroup,
    groupsShownInThreads,
    sidebarPages,
    setSidebarPages,
    availablePages,
    collapsedPages,
    setCollapsedPages,
    togglePageCollapsed,
  };
}
