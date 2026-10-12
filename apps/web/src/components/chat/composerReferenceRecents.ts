import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useSyncExternalStore } from "react";

import {
  type ComposerReferenceItem,
  type ComposerReferenceRecent,
  composerReferenceTabForItem,
  isProjectScopedReferenceTab,
} from "./composerReferenceMenu.logic";

const STORAGE_KEY = "t3code:composer-reference-recents:v1";
const MAX_RECENTS = 60;

interface StoredRecent extends ComposerReferenceRecent {
  readonly environmentId: string;
}

const EMPTY_RECENTS: ReadonlyArray<StoredRecent> = [];
let snapshot: ReadonlyArray<StoredRecent> | null = null;
const listeners = new Set<() => void>();

function isStoredRecent(value: unknown): value is StoredRecent {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<StoredRecent>;
  return (
    typeof entry.environmentId === "string" &&
    typeof entry.scope === "string" &&
    typeof entry.item === "object" &&
    entry.item !== null &&
    typeof entry.item.id === "string" &&
    typeof entry.item.type === "string"
  );
}

function readSnapshot(): ReadonlyArray<StoredRecent> {
  if (snapshot !== null) return snapshot;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    snapshot = Array.isArray(parsed) ? parsed.filter(isStoredRecent) : EMPTY_RECENTS;
  } catch {
    snapshot = EMPTY_RECENTS;
  }
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Remembers references inserted from the `#` menu, newest first. `projectId` scopes pull requests
 * and GitHub issues, which only make sense in the project they came from.
 */
export function recordComposerReferenceRecents(
  environmentId: EnvironmentId,
  projectId: string | null,
  items: ReadonlyArray<ComposerReferenceItem>,
): void {
  const added = items.flatMap((item): StoredRecent[] => {
    if (!isProjectScopedReferenceTab(composerReferenceTabForItem(item))) {
      return [{ environmentId, scope: "", item }];
    }
    return projectId === null ? [] : [{ environmentId, scope: projectId, item }];
  });
  if (added.length === 0) return;
  const addedIds = new Set(added.map((entry) => `${entry.environmentId}:${entry.item.id}`));
  snapshot = [
    ...added.toReversed(),
    ...readSnapshot().filter((entry) => !addedIds.has(`${entry.environmentId}:${entry.item.id}`)),
  ].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Recents are a nicety; a full or blocked storage keeps them for this session only.
  }
  for (const listener of listeners) listener();
}

/** Recent `#` inserts usable in this environment and project, newest first. */
export function useComposerReferenceRecents(
  environmentId: EnvironmentId,
  projectId: string | null,
): ReadonlyArray<ComposerReferenceItem> {
  const recents = useSyncExternalStore(subscribe, readSnapshot);
  return useMemo(
    () =>
      recents
        .filter(
          (entry) =>
            entry.environmentId === environmentId &&
            (entry.scope === "" || entry.scope === projectId),
        )
        .map((entry) => entry.item),
    [environmentId, projectId, recents],
  );
}
