import { hiddenTabThreadKeys, listThreadTabMemberships } from "@t3tools/client-runtime/thread-tabs";
import type { EnvironmentId, ThreadTabMembership } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useEffect, useMemo, useState } from "react";

import { runtime } from "../../lib/runtime";
import { useEnvironments } from "../../state/environments";
import { readPreparedConnection } from "../../state/session";

/**
 * Sidebar keys hidden behind their tab group's row, plus the environments that serve chat tabs
 * (the ones whose membership list loaded), so tab actions show only where they can succeed.
 */
export function useHiddenTabThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const { environments } = useEnvironments();
  const threadIds = threads.map((thread) => `${thread.environmentId}:${thread.id}`).join("|");
  const [memberships, setMemberships] = useState<
    ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadTabMembership>>
  >(() => new Map());

  useEffect(() => {
    if (!threadIds) return;
    let active = true;
    void Promise.all(
      environments.map(async (environment) => {
        if (environment.connection.phase !== "connected") return null;
        const prepared = readPreparedConnection(environment.environmentId);
        if (!prepared) return null;
        try {
          const rows = await runtime.runPromise(listThreadTabMemberships(prepared));
          return [environment.environmentId, rows] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!active) return;
      setMemberships((previous) => {
        const next = new Map(previous);
        for (const result of results) if (result) next.set(result[0], result[1]);
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [environments, threadIds]);

  const hiddenTabThreads = useMemo(
    () => hiddenTabThreadKeys(threads, memberships),
    [threads, memberships],
  );
  // Keyed on memberships alone so thread updates do not hand the sidebar a new set.
  const tabEnvironmentIds = useMemo(
    (): ReadonlySet<EnvironmentId> => new Set(memberships.keys()),
    [memberships],
  );
  return useMemo(
    () => ({ hiddenTabThreads, tabEnvironmentIds }),
    [hiddenTabThreads, tabEnvironmentIds],
  );
}
