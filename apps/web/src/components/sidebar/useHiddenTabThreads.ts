import {
  hiddenSidebarTabThreadKeys,
  listThreadTabMemberships,
  subscribeThreadTabGroupNames,
  threadTabGroupNames,
} from "@t3tools/client-runtime/thread-tabs";
import type { EnvironmentId, ThreadTabMembership } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useEffect, useState } from "react";

import { runtime } from "../../lib/runtime";
import { useEnvironments } from "../../state/environments";
import { readPreparedConnection } from "../../state/session";

/**
 * Sidebar keys hidden behind their tab group's row, plus the environments that serve chat tabs
 * (the ones whose membership list loaded), so tab actions show only where they can succeed.
 */
export function useHiddenTabThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const [nameRevision, setNameRevision] = useState(0);
  useEffect(() => subscribeThreadTabGroupNames(() => setNameRevision((value) => value + 1)), []);
  useEffect(() => {
    const refresh = () => setNameRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const { environments } = useEnvironments();
  const threadIds = threads.map((thread) => `${thread.environmentId}:${thread.id}`).join("|");
  const [memberships, setMemberships] = useState<
    ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadTabMembership>>
  >(() => new Map());

  const [checkedThreadKeys, setCheckedThreadKeys] = useState<ReadonlySet<string>>(() => new Set());
  const loadingEnvironmentIds = new Set(
    environments
      .filter((environment) => readPreparedConnection(environment.environmentId) !== null)
      .map((environment) => environment.environmentId),
  );

  useEffect(() => {
    if (!threadIds) return;
    let active = true;
    const requestedThreadKeys = threadIds.split("|");
    void Promise.all(
      environments.map(async (environment) => {
        if (environment.connection.phase !== "connected") return null;
        const prepared = readPreparedConnection(environment.environmentId);
        if (!prepared) return null;
        let rows: ReadonlyArray<ThreadTabMembership> | null = null;
        try {
          rows = await runtime.runPromise(listThreadTabMemberships(prepared));
        } catch {
          // Upstream servers do not serve tabs; their ordinary threads still need to appear.
        }
        if (!active) return;
        setCheckedThreadKeys(
          (previous) =>
            new Set([
              ...previous,
              ...requestedThreadKeys.filter((key) =>
                key.startsWith(`${environment.environmentId}:`),
              ),
            ]),
        );
        if (rows !== null) {
          const memberships = rows;
          setMemberships((previous) =>
            new Map(previous).set(environment.environmentId, memberships),
          );
        }
      }),
    );
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A renamed group or a refocused window refetches memberships another client may have changed.
  }, [environments, threadIds, nameRevision]);

  const hiddenTabThreads = hiddenSidebarTabThreadKeys(
    threads,
    memberships,
    checkedThreadKeys,
    loadingEnvironmentIds,
  );
  // Derived from memberships alone so thread updates do not hand the sidebar a new set.
  const tabEnvironmentIds: ReadonlySet<EnvironmentId> = new Set(memberships.keys());
  const groupNames = threadTabGroupNames(memberships);
  return { hiddenTabThreads, tabEnvironmentIds, groupNames };
}
