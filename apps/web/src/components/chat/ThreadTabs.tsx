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
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import * as Option from "effect/Option";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  type ComposerContextReference,
  toKindScopedComposerContextId,
} from "../../lib/composerContextReferences";
import { runtime } from "../../lib/runtime";
import { newThreadId } from "../../lib/utils";
import { usePreparedConnection } from "../../state/session";
import { useThreadTabContextStore } from "../../threadTabContextStore";
import { Button } from "../ui/button";
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

export function ThreadTabs({
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
  const [error, setError] = useState<string | null>(null);

  if (Option.isNone(prepared)) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    const nextThreadId = newThreadId();
    try {
      await runtime.runPromise(
        createThreadTab(prepared.value, threadId, {
          threadId: nextThreadId,
          modelSelection,
        }),
      );
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: nextThreadId },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create tab.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b px-3 py-1">
      <div className="flex items-center gap-1 overflow-x-auto">
        {group.tabs.map((tab) => (
          <Button
            key={tab.threadId}
            size="sm"
            variant={tab.threadId === threadId ? "secondary" : "ghost"}
            onClick={() =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: tab.threadId },
              })
            }
          >
            {tab.title}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void create()}>
          + Tab
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
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

  const insert = async (tab: ThreadTabGroup["tabs"][number]) => {
    setLoadingId(tab.threadId);
    setError(null);
    try {
      const handoff = await runtime.runPromise(
        prepareThreadTabHandoff(prepared.value, threadId, { sourceThreadIds: [tab.threadId] }),
      );
      const contextId = toKindScopedComposerContextId("thread-tab", tab.threadId);
      const label = sanitizeComposerContextLabel(tab.title, "thread-tab");
      upsertRecord(threadId, {
        version: 1,
        kind: "thread-tab",
        contextId,
        label,
        threadId: tab.threadId,
        title: tab.title.slice(0, 2_048),
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
          <Toggle
            key={tab.threadId}
            size="compact"
            variant="pill"
            pressed={false}
            disabled={loadingId !== null}
            onClick={() => void insert(tab)}
          >
            {tab.title}
          </Toggle>
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
