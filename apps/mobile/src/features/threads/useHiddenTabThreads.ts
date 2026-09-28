import { hiddenTabThreadKeys, listThreadTabMemberships } from "@t3tools/client-runtime/thread-tabs";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadTabMembership } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { runtime } from "../../lib/runtime";
import { readPreparedConnection } from "../../state/session";
import { useWorkspaceState } from "../../state/workspace";

export function useHiddenTabThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const { environments } = useWorkspaceState();
  const threadIds = threads.map((thread) => `${thread.environmentId}:${thread.id}`).join("|");
  const [memberships, setMemberships] = useState<
    ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadTabMembership>>
  >(() => new Map());

  useEffect(() => {
    if (!threadIds) return;
    let active = true;
    void Promise.all(
      environments.map(async (environment) => {
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

  return useMemo(() => hiddenTabThreadKeys(threads, memberships), [threads, memberships]);
}
