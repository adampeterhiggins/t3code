import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadGroupsHidingSettled, threadGroupsShownInThreads } from "@t3tools/contracts/settings";
import { useThreadGroups } from "../../hooks/useThreadGroups";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { collectThreadGroupNames } from "../threadActionMenu.logic";
import { SidebarPagesSchema } from "./organization.logic";
import { availableSidebarPages, resolveSidebarPages, type SidebarPage } from "./organization.logic";

const SIDEBAR_PAGES_KEY = "t3code:sidebar:pages";
const DEFAULT_SIDEBAR_PAGES: readonly string[] = ["threads", "automations"];
const SIDEBAR_EXCLUDED_PAGES_KEY = "t3code:sidebar:excluded-pages";
const NO_EXCLUDED_PAGES: readonly string[] = [];
const SIDEBAR_COLLAPSED_PAGES_KEY = "t3code:sidebar:collapsed-pages";
const NO_COLLAPSED_PAGES: readonly string[] = [];

export function useSidebarOrganization(threads: readonly EnvironmentThreadShell[]) {
  const { groups: threadGroups, saveGroup, deleteGroup } = useThreadGroups();
  const groupsShownInThreads = threadGroupsShownInThreads(threadGroups);
  const groupsHidingSettled = threadGroupsHidingSettled(threadGroups);
  const [storedSidebarPages, setSidebarPages] = useLocalStorage(
    SIDEBAR_PAGES_KEY,
    DEFAULT_SIDEBAR_PAGES,
    SidebarPagesSchema,
  );
  // Exclusions are the other way to narrow Show, as on Projects: a dimension holds picks or
  // exclusions, never both, so excluding resets picks to the default and picking clears them.
  const [storedExcludedPages, setStoredExcludedPages] = useLocalStorage(
    SIDEBAR_EXCLUDED_PAGES_KEY,
    NO_EXCLUDED_PAGES,
    SidebarPagesSchema,
  );
  const threadGroupNames = collectThreadGroupNames(threads, Object.keys(threadGroups));
  const availablePages = availableSidebarPages(threadGroupNames);
  const sidebarPages = resolveSidebarPages(
    storedSidebarPages,
    threadGroupNames,
    storedExcludedPages,
  );
  const excludedPages = availablePages.filter((page) => storedExcludedPages.includes(page));
  const pickSidebarPages = (pages: readonly SidebarPage[]) => {
    setSidebarPages(pages);
    setStoredExcludedPages(NO_EXCLUDED_PAGES);
  };
  const setExcludedPages = (pages: readonly SidebarPage[]) => {
    setStoredExcludedPages(pages);
    if (pages.length > 0) setSidebarPages(["threads"]);
  };
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
    groupsHidingSettled,
    sidebarPages,
    setSidebarPages,
    pickSidebarPages,
    excludedPages,
    setExcludedPages,
    setStoredExcludedPages,
    availablePages,
    collapsedPages,
    setCollapsedPages,
    togglePageCollapsed,
  };
}
