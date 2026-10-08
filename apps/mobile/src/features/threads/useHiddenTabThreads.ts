import {
  hiddenSidebarTabThreadKeys,
  listThreadTabMemberships,
  subscribeThreadTabGroupNames,
  threadTabGroupNames,
} from "@t3tools/client-runtime/thread-tabs";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadTabMembership } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { AppState } from "react-native";
import { runtime } from "../../lib/runtime";
import { readPreparedConnection } from "../../state/session";
import { useWorkspaceState } from "../../state/workspace";

export function useHiddenTabThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const [nameRevision, setNameRevision] = useState(0);
  useEffect(() => subscribeThreadTabGroupNames(() => setNameRevision((value) => value + 1)), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNameRevision((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);
  const { environments } = useWorkspaceState();
  const threadIds = threads.map((thread) => `${thread.environmentId}:${thread.id}`).join("|");
  const [memberships, setMemberships] = useState<
    ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadTabMembership>>
  >(() => new Map());

  const [checkedThreadKeys, setCheckedThreadKeys] = useState<ReadonlySet<string>>(() => new Set());
  const loadingEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter((environment) => readPreparedConnection(environment.environmentId) !== null)
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );

  useEffect(() => {
    if (!threadIds) return;
    let active = true;
    const requestedThreadKeys = threadIds.split("|");
    void Promise.all(
      environments.map(async (environment) => {
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
  }, [environments, threadIds, nameRevision]);

  const hidden = useMemo(
    () =>
      hiddenSidebarTabThreadKeys(threads, memberships, checkedThreadKeys, loadingEnvironmentIds),
    [threads, memberships, checkedThreadKeys, loadingEnvironmentIds],
  );
  const groupNames = useMemo(() => threadTabGroupNames(memberships), [memberships]);
  return useMemo(() => ({ hiddenTabThreads: hidden, groupNames }), [hidden, groupNames]);
}
