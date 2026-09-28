import {
  createThreadTab,
  listThreadTabs,
  prepareThreadTabHandoff,
} from "@t3tools/client-runtime/thread-tabs";
import {
  COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS,
  type EnvironmentId,
  type ModelSelection,
  type ThreadId,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import * as Option from "effect/Option";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  type ComposerContextReference,
  toKindScopedComposerContextId,
} from "../../lib/composerContextReferences";
import { runtime } from "../../lib/runtime";
import { newThreadId } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { usePreparedConnection } from "../../state/session";
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

/** Tab group for a server thread; null until loaded or when it belongs to another thread. */
export function useThreadTabGroup(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const prepared = usePreparedConnection(environmentId);
  const [group, setGroup] = useState<ThreadTabGroup | null>(null);

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

  return group?.tabs.some((tab) => tab.threadId === threadId) ? group : null;
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

/** Breadcrumb segment naming the open tab; its menu switches tabs or opens a new one. */
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
  const [busy, setBusy] = useState(false);
  const currentLabel = useTabLabel(environmentId, group, threadId);

  const open = (nextThreadId: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: nextThreadId },
    });

  const create = async () => {
    if (Option.isNone(prepared)) return;
    setBusy(true);
    const nextThreadId = newThreadId();
    try {
      await runtime.runPromise(
        createThreadTab(prepared.value, threadId, { threadId: nextThreadId, modelSelection }),
      );
      open(nextThreadId);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not create tab",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger
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
              <TabMenuLabel environmentId={environmentId} group={group} threadId={tab.threadId} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem disabled={busy || Option.isNone(prepared)} onClick={() => void create()}>
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
      onClick={() => props.onSelect(label)}
    >
      {label}
    </Toggle>
  );
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
  const prepared = usePreparedConnection(environmentId);
  const upsertRecord = useThreadTabContextStore((state) => state.upsert);
  const [loadingId, setLoadingId] = useState<ThreadId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const siblings = group.tabs.filter((tab) => tab.threadId !== threadId);
  if (siblings.length === 0 || Option.isNone(prepared)) return null;

  const insert = async (sourceThreadId: ThreadId, title: string) => {
    setLoadingId(sourceThreadId);
    setError(null);
    try {
      const handoff = await runtime.runPromise(
        prepareThreadTabHandoff(prepared.value, threadId, { sourceThreadIds: [sourceThreadId] }),
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
      onInsert({ kind: "thread-tab", contextId, label });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not summarize that tab.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="pb-2">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="shrink-0 text-xs text-muted-foreground">Include context from</span>
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
