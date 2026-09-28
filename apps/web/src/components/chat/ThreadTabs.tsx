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

const selectedSources = new Map<string, ReadonlyArray<ThreadId>>();

export function selectedThreadTabSources(threadId: ThreadId): ReadonlyArray<ThreadId> {
  return selectedSources.get(threadId) ?? [];
}

export function clearSelectedThreadTabSources(threadId: ThreadId): void {
  selectedSources.delete(threadId);
}

export function ThreadTabs({
  environmentId,
  threadId,
  modelSelection,
  empty,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  modelSelection: ModelSelection;
  empty: boolean;
}) {
  const prepared = usePreparedConnection(environmentId);
  const navigate = useNavigate();
  const [group, setGroup] = useState<ThreadTabGroup | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<ThreadId>>(() =>
    selectedThreadTabSources(threadId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Option.isNone(prepared)) return;
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

  if (!group || Option.isNone(prepared)) return null;

  const toggle = (sourceId: ThreadId) => {
    if (!selected.includes(sourceId) && selected.length >= 8) {
      setError("Select up to eight chats for context.");
      return;
    }
    setError(null);
    const next = selected.includes(sourceId)
      ? selected.filter((id) => id !== sourceId)
      : [...selected, sourceId];
    setSelected(next);
    selectedSources.set(threadId, next);
  };

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
      {empty && group.tabs.length > 1 ? (
        <div className="flex items-center gap-1 overflow-x-auto pt-1">
          <span className="text-xs text-muted-foreground">Include context from:</span>
          {group.tabs
            .filter((tab) => tab.threadId !== threadId)
            .map((tab) => (
              <Button
                key={tab.threadId}
                size="sm"
                variant={selected.includes(tab.threadId) ? "secondary" : "ghost"}
                aria-pressed={selected.includes(tab.threadId)}
                onClick={() => toggle(tab.threadId)}
              >
                {tab.title}
              </Button>
            ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
