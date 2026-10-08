import {
  createThreadTab,
  forkThreadTabFromRun,
  listThreadTabs,
  setThreadTabGroupName,
  subscribeThreadTabGroupNames,
  prepareThreadTabHandoff,
} from "@t3tools/client-runtime/thread-tabs";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS,
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type RunId,
  type ScopedThreadRef,
  type ThreadId,
  type ThreadTab,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { useNavigate } from "@tanstack/react-router";
import { Columns2Icon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { requestThreadTabGroupName } from "../ThreadTabGroupNameDialog";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useRestartAgentSessionWithToast } from "../../hooks/useRestartAgentSession";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  type ComposerContextReference,
  formatInlineContextReference,
  toKindScopedComposerContextId,
} from "../../lib/composerContextReferences";
import { runtime } from "../../lib/runtime";
import { newThreadId } from "../../lib/utils";
import {
  useThreadShell,
  useThreadShellsForProjectRefs,
  waitForThreadShell,
} from "../../state/entities";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { deriveProviderEntriesByEnvironment } from "../../providerInstances";
import { environmentServerConfigsAtom } from "../../state/server";
import {
  useEnvironmentScope,
  readPreparedConnection,
  usePreparedConnection,
} from "../../state/session";
import { useThreadTabRecencyStore } from "../../threadTabRecencyStore";
import {
  NO_SIDEBAR_TAB_MANUAL_RANKS,
  SIDEBAR_TAB_MANUAL_RANKS_KEY,
  SidebarTabManualRanksSchema,
  sidebarSiblingTabs,
  sidebarTabSortTimestamp,
  sidebarThreadShelf,
} from "../Sidebar.logic";
import { splitPartnerKey, useSplitViewStore } from "../../splitViewStore";
import { useThreadTabContextStore } from "../../threadTabContextStore";
import { SidebarTabSummary } from "../sidebar/SidebarTabSummary";
import { WorkspaceBreadcrumbText } from "../WorkspaceBreadcrumb";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { useSplitPaneFocus, useSplitViewActions } from "./splitPane";
import { createThreadAttachSummaryLoader } from "./threadAttachPickerSummary";
import { ThreadSummaryPreview } from "./ThreadSummaryPreview";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The last group loaded, so a remounted chat view shows a sibling tab's group at once. */
let lastLoadedThreadTabGroup: ThreadTabGroup | null = null;

/**
 * Tab group for a server thread; null until loaded or when it belongs to another thread.
 * Closed (archived) tabs drop out live, and come back if the archive is undone. Tab titles
 * follow thread renames once the project's shells are loaded.
 */
export function useThreadTabGroup(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const prepared = usePreparedConnection(environmentId);
  const [group, setGroup] = useState(() => lastLoadedThreadTabGroup);
  const [nameRevision, setNameRevision] = useState(0);
  useEffect(() => subscribeThreadTabGroupNames(() => setNameRevision((value) => value + 1)), []);
  const shell = useThreadShell(threadId === null ? null : scopeThreadRef(environmentId, threadId));
  const projectShells = useThreadShellsForProjectRefs(
    shell ? [scopeProjectRef(environmentId, shell.projectId)] : [],
  );

  useEffect(() => {
    if (threadId === null || Option.isNone(prepared)) return;
    let active = true;
    void runtime.runPromise(listThreadTabs(prepared.value, threadId)).then(
      (next) => {
        if (!active) return;
        lastLoadedThreadTabGroup = next;
        setGroup(next);
      },
      () => {
        if (active) setGroup(null);
      },
    );
    return () => {
      active = false;
    };
  }, [prepared, threadId, nameRevision]);

  return useMemo(() => {
    if (!group?.tabs.some((tab) => tab.threadId === threadId)) return null;
    // Archiving removes a thread's shell from the store, so a tab without one has been closed.
    // Until the open thread's shell loads, the project's shells are not known yet.
    if (!shell) return group;
    const titles = new Map(
      projectShells
        .filter((thread) => thread.archivedAt === null)
        .map((thread) => [thread.id, thread.title]),
    );
    if (group.tabs.every((tab) => titles.get(tab.threadId) === tab.title)) return group;
    return {
      ...group,
      tabs: group.tabs.flatMap((tab) => {
        const title = titles.get(tab.threadId);
        return title === undefined ? [] : [{ ...tab, title }];
      }),
    };
  }, [group, projectShells, shell, threadId]);
}

/** Shows or hides `to`'s right panel to match `from`'s, keeping `to`'s own surfaces. */
function carryRightPanelVisibility(from: ScopedThreadRef, to: ScopedThreadRef) {
  const panels = useRightPanelStore.getState();
  const isOpen = selectThreadRightPanelState(panels.byThreadKey, from).isOpen;
  if (selectThreadRightPanelState(panels.byThreadKey, to).isOpen === isOpen) return;
  if (isOpen) panels.show(to);
  else panels.close(to);
}

/** The tab group the chat view last showed, so a switch to a sibling tab can be recognised. */
let lastShownTab: { ref: ScopedThreadRef; tabIds: ReadonlySet<ThreadId> } | null = null;

/**
 * Keeps the right panel's visibility steady across a tab switch: the next tab opens or
 * closes its panel to match the tab you came from, showing its own surfaces. Runs before
 * paint so the panel never flickers shut. New tabs are covered where they are created.
 */
export function useRightPanelFollowsTabSwitch(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  group: ThreadTabGroup | null,
) {
  useLayoutEffect(() => {
    const previous = lastShownTab;
    if (
      threadId === null ||
      previous === null ||
      previous.ref.environmentId !== environmentId ||
      previous.ref.threadId === threadId ||
      !previous.tabIds.has(threadId)
    ) {
      return;
    }
    carryRightPanelVisibility(previous.ref, scopeThreadRef(environmentId, threadId));
  }, [environmentId, threadId]);

  useLayoutEffect(() => {
    lastShownTab =
      threadId !== null && group
        ? {
            ref: scopeThreadRef(environmentId, threadId),
            tabIds: new Set(group.tabs.map((tab) => tab.threadId)),
          }
        : null;
  }, [environmentId, group, threadId]);
}

/** The tab that takes over when `threadId` closes: the next one, else the previous. */
export function threadTabNeighbour(
  group: Pick<ThreadTabGroup, "tabs">,
  threadId: ThreadId,
): ThreadId | null {
  const index = group.tabs.findIndex((tab) => tab.threadId === threadId);
  if (index === -1) return null;
  return (group.tabs[index + 1] ?? group.tabs[index - 1])?.threadId ?? null;
}

/**
 * Opens and closes chat tabs for any surface: the header crumb, the sidebar, and thread menus.
 * Failures toast here, so callers only need to await.
 */
export function useThreadTabActions() {
  const navigate = useNavigate();
  const { archiveThread } = useThreadActions();

  /** Adds a tab to `source`'s group (making one if needed) and opens it. */
  const createTab = useCallback(
    async (source: ScopedThreadRef, modelSelection: ModelSelection) => {
      try {
        const prepared = readPreparedConnection(source.environmentId);
        if (!prepared) throw new Error("This environment is not connected.");
        const threadRef = scopeThreadRef(source.environmentId, newThreadId());
        await runtime.runPromise(
          createThreadTab(prepared, source.threadId, {
            threadId: threadRef.threadId,
            modelSelection,
          }),
        );
        carryRightPanelVisibility(source, threadRef);
        // The thread route redirects away from threads the client store has not heard of yet.
        await waitForThreadShell(threadRef);
        await navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
        });
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: "Could not create tab",
          description: cause instanceof Error ? cause.message : undefined,
        });
      }
    },
    [navigate],
  );

  /**
   * Closing archives the tab's thread, so undo and the archived-threads list can reopen it.
   * Closing the open tab lands on `next`.
   */
  const closeTab = useCallback(
    async (tab: ScopedThreadRef, next: ScopedThreadRef) => {
      const result = await archiveThread(tab, { next });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not close tab",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [archiveThread],
  );

  return { createTab, closeTab };
}

/** A tab's name everywhere it appears: the live thread title, so renames show up immediately. */
function useTabLabel(environmentId: EnvironmentId, group: ThreadTabGroup, threadId: ThreadId) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  return shell?.title ?? group.tabs.find((tab) => tab.threadId === threadId)?.title ?? "Tab";
}

function TabMenuLabel(props: {
  environmentId: EnvironmentId;
  group: ThreadTabGroup;
  threadId: ThreadId;
}) {
  return <>{useTabLabel(props.environmentId, props.group, props.threadId)}</>;
}

/**
 * Breadcrumb segment naming the open tab; its menu switches, opens, or closes tabs, and restarts
 * the open tab's agent session.
 * A "new tab" button always follows it; with a single tab it is only that button.
 */
export function ThreadTabMenu({
  environmentId,
  threadId,
  modelSelection,
  group,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  modelSelection: ModelSelection;
  group: ThreadTabGroup;
}) {
  const prepared = usePreparedConnection(environmentId);
  const navigate = useNavigate();
  const { createTab, closeTab } = useThreadTabActions();
  const restartAgentSession = useRestartAgentSessionWithToast();
  const [busy, setBusy] = useState(false);
  const canNameGroup = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const currentLabel = useTabLabel(environmentId, group, threadId);
  const splitPaneFocus = useSplitPaneFocus();
  const splitActions = useSplitViewActions();
  const currentKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
  const splitPartner = useSplitViewStore((state) => splitPartnerKey(state.panes, currentKey));

  const open = (nextThreadId: ThreadId) => {
    const next = scopeThreadRef(environmentId, nextThreadId);
    // In a split, each pane's tab menu switches that pane.
    if (splitPaneFocus !== null) {
      useSplitViewStore.getState().replace(currentKey, scopedThreadKey(next));
      splitActions.focusPane(next);
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: nextThreadId },
    });
  };

  const openBeside = (tabThreadId: ThreadId) =>
    splitActions.openBeside(
      scopeThreadRef(environmentId, threadId),
      scopeThreadRef(environmentId, tabThreadId),
    );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const close = (tabThreadId: ThreadId) => {
    const next = threadTabNeighbour(group, tabThreadId);
    if (!next) return;
    void run(() =>
      closeTab(scopeThreadRef(environmentId, tabThreadId), scopeThreadRef(environmentId, next)),
    );
  };

  const create = () =>
    void run(() => createTab(scopeThreadRef(environmentId, threadId), modelSelection));

  const restart = () =>
    void run(() => restartAgentSession(scopeThreadRef(environmentId, threadId)));

  const newTabButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="New tab"
            disabled={busy || Option.isNone(prepared)}
            onClick={create}
            className="inline-flex shrink-0 cursor-pointer items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
          />
        }
      >
        <PlusIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">New tab</TooltipPopup>
    </Tooltip>
  );

  // A lone tab repeats the thread title, so the segment is just the "new tab" action.
  if (group.tabs.length <= 1 && !group.name) return newTabButton;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Menu>
        {/* Themed headers fill every menu-trigger slot as a toolbar control; this is a breadcrumb. */}
        <MenuTrigger
          data-slot="thread-tab-crumb"
          render={
            <button
              type="button"
              aria-label={`Chat tab: ${group.name ?? currentLabel}`}
              className="group/tab-crumb inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <WorkspaceBreadcrumbText>{group.name ?? currentLabel}</WorkspaceBreadcrumbText>
        </MenuTrigger>
        <MenuPopup align="start" side="bottom">
          <MenuRadioGroup value={threadId} onValueChange={(value) => open(value as ThreadId)}>
            {group.tabs.map((tab) => (
              <MenuRadioItem key={tab.threadId} value={tab.threadId}>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <TabMenuLabel
                      environmentId={environmentId}
                      group={group}
                      threadId={tab.threadId}
                    />
                  </span>
                  {/* Shown on the highlighted row; handlers stop the item from switching tabs. */}
                  {tab.threadId !== threadId &&
                  splitPartner !== scopedThreadKey(scopeThreadRef(environmentId, tab.threadId)) ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Open in split view"
                      onMouseUp={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        openBeside(tab.threadId);
                      }}
                      className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground in-data-highlighted:opacity-100"
                    >
                      <Columns2Icon className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close tab"
                    disabled={busy}
                    onMouseUp={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      close(tab.threadId);
                    }}
                    className="-me-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground in-data-highlighted:opacity-100 disabled:cursor-default disabled:opacity-0"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem disabled={busy || Option.isNone(prepared)} onClick={create}>
            <PlusIcon />
            New tab
          </MenuItem>
          <MenuItem
            disabled={busy || !canNameGroup || Option.isNone(prepared)}
            onClick={() =>
              void run(async () => {
                if (!canNameGroup) return;
                const name = await requestThreadTabGroupName(group.name ?? null);
                if (name === undefined || Option.isNone(prepared)) return;
                try {
                  await runtime.runPromise(setThreadTabGroupName(prepared.value, threadId, name));
                } catch {
                  toastManager.add({ type: "error", title: "Could not name thread group" });
                }
              })
            }
          >
            Name thread group…
          </MenuItem>
          <MenuItem disabled={busy || Option.isNone(prepared)} onClick={restart}>
            <RotateCcwIcon />
            Restart agent session
          </MenuItem>
        </MenuPopup>
      </Menu>
      {newTabButton}
    </span>
  );
}

function ThreadTabContextPill(props: {
  environmentId: EnvironmentId;
  group: ThreadTabGroup;
  threadId: ThreadId;
  summary: TabSummary | undefined;
  disabled: boolean;
  loadSummary: ReturnType<typeof createThreadAttachSummaryLoader>;
  onSelect: (title: string) => void;
}) {
  const label = useTabLabel(props.environmentId, props.group, props.threadId);
  return (
    <CursorPreviewCard
      trigger={
        <Toggle
          size="compact"
          variant="pill"
          pressed={false}
          disabled={props.disabled}
          aria-label={`Include context from ${label}`}
          className="min-w-0"
          onClick={() => props.onSelect(label)}
        >
          {props.summary ? (
            // Trailing room keeps the instance badge, which overhangs the icon, inside the pill.
            <span className="flex min-w-0 flex-1 items-center gap-2 pe-1">
              <SidebarTabSummary {...props.summary} compact />
            </span>
          ) : (
            <span className="truncate">{label}</span>
          )}
        </Toggle>
      }
    >
      <ThreadSummaryPreview
        environmentId={props.environmentId}
        threadId={props.threadId}
        title={label}
        parentTitle={null}
        loadSummary={props.loadSummary}
      />
    </CursorPreviewCard>
  );
}

/** The transcript summary of a sibling tab, as captured into the draft of `threadId`. */
async function fetchThreadTabSummary(
  connection: PreparedConnection,
  input: {
    threadId: ThreadId;
    sourceThreadId: ThreadId;
    beforeMessageId?: MessageId;
    afterMessageId?: MessageId;
  },
): Promise<string> {
  const handoff = await runtime.runPromise(
    prepareThreadTabHandoff(connection, input.threadId, {
      sourceThreadIds: [input.sourceThreadId],
      ...(input.beforeMessageId ? { beforeMessageId: input.beforeMessageId } : {}),
      ...(input.afterMessageId ? { afterMessageId: input.afterMessageId } : {}),
    }),
  );
  return handoff.text.slice(0, COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS);
}

/**
 * Captures a sibling tab's transcript summary into the draft of `threadId` and resolves to the
 * chip reference for the composer to place. With `beforeMessageId`, only the history before
 * that user message of the source is summarized; `afterMessageId` includes the assistant response.
 * A `summary` already fetched for a preview is
 * used as is.
 */
async function captureThreadTabContext(
  connection: PreparedConnection,
  input: {
    threadId: ThreadId;
    sourceThreadId: ThreadId;
    title: string;
    beforeMessageId?: MessageId;
    afterMessageId?: MessageId;
    summary?: string;
  },
): Promise<ComposerContextReference> {
  const summary = input.summary ?? (await fetchThreadTabSummary(connection, input));
  return storeThreadTabContext(input.threadId, {
    producerId: input.sourceThreadId,
    sourceThreadId: input.sourceThreadId,
    title: input.title,
    summary,
  });
}

/** Holds `summary` behind a chat-summary chip in the draft of `threadId`. */
function storeThreadTabContext(
  threadId: ThreadId,
  input: { producerId: string; sourceThreadId: ThreadId; title: string; summary: string },
): ComposerContextReference {
  const contextId = toKindScopedComposerContextId("thread-tab", input.producerId);
  const label = sanitizeComposerContextLabel(input.title, "thread-tab");
  useThreadTabContextStore.getState().upsert(threadId, {
    version: 1,
    kind: "thread-tab",
    contextId,
    label,
    threadId: input.sourceThreadId,
    title: input.title.slice(0, 2_048),
    summary: input.summary.slice(0, COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS),
  });
  return { kind: "thread-tab", contextId, label } satisfies ComposerContextReference;
}

/** Hook form of `captureThreadTabContext`, bound to the thread being composed in. */
export function useCaptureThreadTabContext(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
) {
  const prepared = usePreparedConnection(environmentId);
  return useMemo(() => {
    if (threadId === null || Option.isNone(prepared)) return null;
    const connection = prepared.value;
    return {
      capture: (sourceThreadId: ThreadId, title: string, summary?: string) =>
        captureThreadTabContext(connection, {
          threadId,
          sourceThreadId,
          title,
          ...(summary !== undefined ? { summary } : {}),
        }),
      fetchSummary: (sourceThreadId: ThreadId) =>
        fetchThreadTabSummary(connection, { threadId, sourceThreadId }),
    };
  }, [prepared, threadId]);
}

/**
 * Forks a chat into a new tab of the same thread, on `modelSelection`: the new draft holds a
 * summary of the source chat, cut before `beforeMessageId` or through `afterMessageId`, followed
 * by `prompt`. Resolves to the new tab once the client knows about it.
 */
export async function forkThreadTab(
  connection: PreparedConnection,
  input: {
    environmentId: EnvironmentId;
    sourceThreadId: ThreadId;
    sourceTitle: string;
    modelSelection: ModelSelection;
    beforeMessageId?: MessageId;
    afterMessageId?: MessageId;
    /** Composer text to follow the summary. */
    prompt: string;
    /** False when forking from the chat's first message, which leaves nothing to summarize. */
    hasHistory: boolean;
    /**
     * Context captured by the caller, such as a subagent's work, attached in place of the source
     * chat's summary. `producerId` keeps its chip distinct from the chat's own.
     */
    context?: { producerId: string; title: string; summary: string };
  },
): Promise<ScopedThreadRef> {
  const threadId = newThreadId();
  await runtime.runPromise(
    createThreadTab(connection, input.sourceThreadId, {
      threadId,
      modelSelection: input.modelSelection,
    }),
  );
  const threadRef = scopeThreadRef(input.environmentId, threadId);
  carryRightPanelVisibility(scopeThreadRef(input.environmentId, input.sourceThreadId), threadRef);
  const reference = input.context
    ? storeThreadTabContext(threadId, { ...input.context, sourceThreadId: input.sourceThreadId })
    : input.hasHistory
      ? await captureThreadTabContext(connection, {
          threadId,
          sourceThreadId: input.sourceThreadId,
          title: input.sourceTitle,
          ...(input.beforeMessageId ? { beforeMessageId: input.beforeMessageId } : {}),
          ...(input.afterMessageId ? { afterMessageId: input.afterMessageId } : {}),
        })
      : null;
  useComposerDraftStore
    .getState()
    .setPrompt(
      threadRef,
      [reference ? formatInlineContextReference(reference) : "", input.prompt]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    );
  // The thread route redirects away from threads the client store has not heard of yet.
  await waitForThreadShell(threadRef);
  return threadRef;
}

/**
 * Forks a chat at a completed response into a new tab of `tabThreadId`'s group with the native
 * thread fork, so the new tab carries the conversation itself rather than a summary of it. With
 * `modelSelection`, the new tab runs that model. Resolves to the new tab once the client knows
 * about it.
 */
export async function forkResponseIntoTab(
  connection: PreparedConnection,
  input: {
    environmentId: EnvironmentId;
    tabThreadId: ThreadId;
    sourceThreadId: ThreadId;
    runId: RunId;
    title: string;
    modelSelection?: ModelSelection;
  },
): Promise<ScopedThreadRef> {
  const threadId = newThreadId();
  await runtime.runPromise(
    forkThreadTabFromRun(connection, input.tabThreadId, {
      threadId,
      sourceThreadId: input.sourceThreadId,
      runId: input.runId,
      title: input.title,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    }),
  );
  const threadRef = scopeThreadRef(input.environmentId, threadId);
  carryRightPanelVisibility(scopeThreadRef(input.environmentId, input.tabThreadId), threadRef);
  // The thread route redirects away from threads the client store has not heard of yet.
  await waitForThreadShell(threadRef);
  return threadRef;
}

/**
 * The other tabs of `group` in the sidebar's order, split where the sidebar folds the rest behind
 * its "more" row, so each tab keeps the place it has there.
 */
function useSidebarSiblingTabs(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  group: ThreadTabGroup,
) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  const projectShells = useThreadShellsForProjectRefs(
    shell ? [scopeProjectRef(environmentId, shell.projectId)] : [],
  );
  const tabLimit = useClientSettings((s) => s.sidebarTabLimit);
  const tabSortOrder = useClientSettings((s) => s.sidebarTabSortOrder);
  const tabSortDirection = useClientSettings((s) => s.sidebarTabSortDirection);
  const workingShelfEnabled = useClientSettings((s) => s.sidebarWorkingShelfEnabled);
  const [manualRanks] = useLocalStorage(
    SIDEBAR_TAB_MANUAL_RANKS_KEY,
    NO_SIDEBAR_TAB_MANUAL_RANKS,
    SidebarTabManualRanksSchema,
  );
  const openedAtByThreadKey = useThreadTabRecencyStore((s) => s.openedAtByThreadKey);
  const serverConfig = useAtomValue(environmentServerConfigsAtom).get(environmentId);
  const capabilities = serverConfig?.environment.capabilities;
  const providerEntries = useMemo(
    () =>
      serverConfig
        ? deriveProviderEntriesByEnvironment([
            [environmentId, serverConfig.providers, serverConfig.settings],
          ]).get(environmentId)
        : undefined,
    [environmentId, serverConfig],
  );

  const tabs = useMemo(() => {
    const shellById = new Map(projectShells.map((thread) => [thread.id, thread]));
    const tabKey = (tab: Pick<ThreadTab, "threadId">) =>
      scopedThreadKey(scopeThreadRef(environmentId, tab.threadId));
    // The group's first tab stands for it in the sidebar; its shelf decides card or slim row.
    const row = group.tabs[0] ? shellById.get(group.tabs[0].threadId) : undefined;
    const shelf = row
      ? sidebarThreadShelf(row, {
          supportsSnooze: capabilities?.threadSnooze === true,
          supportsSettlement: capabilities?.threadSettlement === true,
          workingShelfEnabled,
          now: new Date().toISOString(),
        })
      : "active";
    const { shown, hidden } = sidebarSiblingTabs(group.tabs, {
      listsRow: shelf === "pinned" || shelf === "active",
      order: tabSortOrder,
      direction: tabSortDirection,
      getKey: tabKey,
      getTimestamp: (tab, order) => {
        const tabShell = shellById.get(tab.threadId);
        return tabShell
          ? sidebarTabSortTimestamp(tabShell, order, openedAtByThreadKey[tabKey(tab)])
          : null;
      },
      manualRanks,
      limit: tabLimit,
      openKey: tabKey({ threadId }),
    });
    return { shown, hidden, shellById };
  }, [
    capabilities,
    environmentId,
    group,
    manualRanks,
    openedAtByThreadKey,
    projectShells,
    tabLimit,
    tabSortDirection,
    tabSortOrder,
    threadId,
    workingShelfEnabled,
  ]);

  /** What the sidebar row of a sibling tab shows, once its shell has loaded. */
  const summaryOf = (tabThreadId: ThreadId): TabSummary | undefined => {
    const thread = tabs.shellById.get(tabThreadId);
    return thread
      ? {
          thread,
          providerEntries,
          tabSortOrder,
          openedAt:
            openedAtByThreadKey[scopedThreadKey(scopeThreadRef(environmentId, tabThreadId))],
        }
      : undefined;
  };
  return { shown: tabs.shown, hidden: tabs.hidden, summaryOf };
}

type TabSummary = Omit<ComponentProps<typeof SidebarTabSummary>, "compact">;

/**
 * Sibling tabs an empty tab can pull context from, in the sidebar's order and up to its tab
 * limit, with the rest behind a "more" pill. Clicking one captures that tab's transcript
 * summary and hands back a chip reference for the composer to place at the caret.
 */
export function ThreadTabContextPills({
  environmentId,
  threadId,
  group,
  onInsert,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  group: ThreadTabGroup;
  onInsert: (reference: ComposerContextReference) => void;
}) {
  const threadTabContext = useCaptureThreadTabContext(environmentId, threadId);
  // Summaries fetched on hover are kept so a later click inserts what the preview showed.
  const loadSummary = useMemo(
    () =>
      threadTabContext === null
        ? null
        : createThreadAttachSummaryLoader(threadTabContext.fetchSummary),
    [threadTabContext],
  );
  const [loadingId, setLoadingId] = useState<ThreadId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden, summaryOf } = useSidebarSiblingTabs(environmentId, threadId, group);
  if (shown.length + hidden.length === 0 || threadTabContext === null || loadSummary === null) {
    return null;
  }
  const siblings = expanded ? [...shown, ...hidden] : shown;

  const insert = async (sourceThreadId: ThreadId, title: string) => {
    setLoadingId(sourceThreadId);
    setError(null);
    try {
      const summary = await loadSummary(sourceThreadId);
      onInsert(await threadTabContext.capture(sourceThreadId, title, summary));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not summarize that tab.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="pb-3">
      <p className="pb-2 text-xs text-muted-foreground">Include context from</p>
      {/* Fixed thirds of the composer width, wrapping onto new rows instead of scrolling. */}
      <div className="grid grid-cols-3 gap-1.5">
        {siblings.map((tab) => (
          <ThreadTabContextPill
            key={tab.threadId}
            environmentId={environmentId}
            group={group}
            threadId={tab.threadId}
            summary={summaryOf(tab.threadId)}
            disabled={loadingId !== null}
            loadSummary={loadSummary}
            onSelect={(title) => void insert(tab.threadId, title)}
          />
        ))}
        {hidden.length > 0 && expanded ? (
          <Toggle
            size="compact"
            variant="pill"
            pressed={false}
            className="min-w-0"
            onClick={() => setExpanded(false)}
          >
            <span className="truncate">Show less</span>
          </Toggle>
        ) : null}
        {hidden.length > 0 && !expanded ? (
          // Previews which tabs are folded away before expanding them.
          <CursorPreviewCard
            className="w-80 max-w-[calc(100vw-2rem)]"
            trigger={
              <Toggle
                size="compact"
                variant="pill"
                pressed={false}
                className="min-w-0"
                onClick={() => setExpanded(true)}
              >
                <span className="truncate">{hidden.length} more</span>
              </Toggle>
            }
          >
            <ul className="flex max-h-80 flex-col gap-px overflow-y-auto overscroll-contain">
              {hidden.map((tab) => {
                const summary = summaryOf(tab.threadId);
                return (
                  <li key={tab.threadId} className="flex h-7 items-center gap-2 px-1">
                    {summary ? (
                      <SidebarTabSummary {...summary} />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <TabMenuLabel
                          environmentId={environmentId}
                          group={group}
                          threadId={tab.threadId}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CursorPreviewCard>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="pt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
