import {
  createThreadTab,
  listThreadTabs,
  prepareThreadTabHandoff,
} from "@t3tools/client-runtime/thread-tabs";
import {
  COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS,
  type EnvironmentId,
  type ModelSelection,
  type ScopedThreadRef,
  type ThreadId,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import * as Option from "effect/Option";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import {
  type ComposerContextReference,
  toKindScopedComposerContextId,
} from "../../lib/composerContextReferences";
import { runtime } from "../../lib/runtime";
import { newThreadId } from "../../lib/utils";
import {
  useThreadShell,
  useThreadShellsForProjectRefs,
  waitForThreadShell,
} from "../../state/entities";
import { readPreparedConnection, usePreparedConnection } from "../../state/session";
import { useThreadTabContextStore } from "../../threadTabContextStore";
import { WorkspaceBreadcrumbText } from "../WorkspaceBreadcrumb";
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

/**
 * Tab group for a server thread; null until loaded or when it belongs to another thread.
 * Closed (archived) tabs drop out live, and come back if the archive is undone. Tab titles
 * follow thread renames once the project's shells are loaded.
 */
export function useThreadTabGroup(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const prepared = usePreparedConnection(environmentId);
  const [group, setGroup] = useState<ThreadTabGroup | null>(null);
  const shell = useThreadShell(threadId === null ? null : scopeThreadRef(environmentId, threadId));
  const projectShells = useThreadShellsForProjectRefs(
    shell ? [scopeProjectRef(environmentId, shell.projectId)] : [],
  );

  useEffect(() => {
    if (threadId === null || Option.isNone(prepared)) return;
    let active = true;
    void runtime.runPromise(listThreadTabs(prepared.value, threadId)).then(
      (next) => {
        if (active) setGroup(next);
      },
      () => {
        if (active) setGroup(null);
      },
    );
    return () => {
      active = false;
    };
  }, [prepared, threadId]);

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
 * Breadcrumb segment naming the open tab; its menu switches, opens, or closes tabs.
 * With a single tab it is just a "new tab" button.
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
  const [busy, setBusy] = useState(false);
  const currentLabel = useTabLabel(environmentId, group, threadId);

  const open = (nextThreadId: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: nextThreadId },
    });

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

  // A lone tab repeats the thread title, so the segment becomes a direct "new tab" action.
  if (group.tabs.length <= 1) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New tab"
              disabled={busy || Option.isNone(prepared)}
              onClick={create}
              className="inline-flex cursor-pointer items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            />
          }
        >
          <PlusIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">New tab</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Menu>
      {/* Themed headers fill every menu-trigger slot as a toolbar control; this is a breadcrumb. */}
      <MenuTrigger
        data-slot="thread-tab-crumb"
        render={
          <button
            type="button"
            aria-label={`Chat tab: ${currentLabel}`}
            className="group/tab-crumb inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <WorkspaceBreadcrumbText>{currentLabel}</WorkspaceBreadcrumbText>
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
      </MenuPopup>
    </Menu>
  );
}

function ThreadTabContextPill(props: {
  environmentId: EnvironmentId;
  group: ThreadTabGroup;
  threadId: ThreadId;
  disabled: boolean;
  onSelect: (title: string) => void;
}) {
  const label = useTabLabel(props.environmentId, props.group, props.threadId);
  return (
    <Toggle
      size="compact"
      variant="pill"
      pressed={false}
      disabled={props.disabled}
      title={label}
      className="min-w-0"
      onClick={() => props.onSelect(label)}
    >
      <span className="truncate">{label}</span>
    </Toggle>
  );
}

/**
 * Captures a sibling tab's transcript summary into the draft of `threadId` and resolves to the
 * chip reference for the composer to place. Null until the thread and connection are ready.
 */
export function useCaptureThreadTabContext(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
) {
  const prepared = usePreparedConnection(environmentId);
  const upsertRecord = useThreadTabContextStore((state) => state.upsert);
  return useMemo(() => {
    if (threadId === null || Option.isNone(prepared)) return null;
    const connection = prepared.value;
    return async (sourceThreadId: ThreadId, title: string): Promise<ComposerContextReference> => {
      const handoff = await runtime.runPromise(
        prepareThreadTabHandoff(connection, threadId, { sourceThreadIds: [sourceThreadId] }),
      );
      const contextId = toKindScopedComposerContextId("thread-tab", sourceThreadId);
      const label = sanitizeComposerContextLabel(title, "thread-tab");
      upsertRecord(threadId, {
        version: 1,
        kind: "thread-tab",
        contextId,
        label,
        threadId: sourceThreadId,
        title: title.slice(0, 2_048),
        summary: handoff.text.slice(0, COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS),
      });
      return { kind: "thread-tab", contextId, label } satisfies ComposerContextReference;
    };
  }, [prepared, threadId, upsertRecord]);
}

/**
 * Sibling tabs an empty tab can pull context from. Clicking one captures that tab's transcript
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
  const capture = useCaptureThreadTabContext(environmentId, threadId);
  const [loadingId, setLoadingId] = useState<ThreadId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const siblings = group.tabs.filter((tab) => tab.threadId !== threadId);
  if (siblings.length === 0 || capture === null) return null;

  const insert = async (sourceThreadId: ThreadId, title: string) => {
    setLoadingId(sourceThreadId);
    setError(null);
    try {
      onInsert(await capture(sourceThreadId, title));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not summarize that tab.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="pb-2">
      <p className="pb-1.5 text-xs text-muted-foreground">Include context from</p>
      {/* Fixed thirds of the composer width, wrapping onto new rows instead of scrolling. */}
      <div className="grid grid-cols-3 gap-1.5">
        {siblings.map((tab) => (
          <ThreadTabContextPill
            key={tab.threadId}
            environmentId={environmentId}
            group={group}
            threadId={tab.threadId}
            disabled={loadingId !== null}
            onSelect={(title) => void insert(tab.threadId, title)}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="pt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
