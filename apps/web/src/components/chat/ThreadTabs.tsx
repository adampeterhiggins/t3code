import { createThreadTab, listThreadTabs } from "@t3tools/client-runtime/thread-tabs";
import {
  type EnvironmentId,
  type ModelSelection,
  ThreadId,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { runtime } from "../../lib/runtime";
import { newThreadId } from "../../lib/utils";
import { usePreparedConnection } from "../../state/session";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";

const selectedSources = new Map<string, ReadonlyArray<ThreadId>>();

export function selectedThreadTabSources(threadId: ThreadId): ReadonlyArray<ThreadId> {
  return selectedSources.get(threadId) ?? [];
}

export function clearSelectedThreadTabSources(threadId: ThreadId): void {
  selectedSources.delete(threadId);
}

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

/** Sibling tabs the first message of an empty tab can pull context from. */
export function ThreadTabContextPills({
  threadId,
  group,
}: {
  threadId: ThreadId;
  group: ThreadTabGroup;
}) {
  const [selected, setSelected] = useState<ReadonlyArray<ThreadId>>(() =>
    selectedThreadTabSources(threadId),
  );
  const [error, setError] = useState<string | null>(null);
  const siblings = group.tabs.filter((tab) => tab.threadId !== threadId);
  if (siblings.length === 0) return null;

  const toggle = (sourceId: ThreadId, pressed: boolean) => {
    if (pressed && selected.length >= 8) {
      setError("Select up to eight chats for context.");
      return;
    }
    setError(null);
    const next = pressed ? [...selected, sourceId] : selected.filter((id) => id !== sourceId);
    setSelected(next);
    selectedSources.set(threadId, next);
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
            pressed={selected.includes(tab.threadId)}
            onPressedChange={(pressed) => toggle(tab.threadId, pressed)}
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
