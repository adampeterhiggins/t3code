import type { ThreadGroup, ThreadGroups } from "@t3tools/contracts/settings";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";

import { environmentServerConfigsAtom } from "../state/server";
import { useUpdatePrimarySettings } from "./useSettings";

const NO_GROUPS: ThreadGroups = {};

/**
 * The user's thread groups and their looks. They are a shared server setting, written to every
 * connected environment, so reading merges them: a group exists and looks the same whichever
 * server its threads are on, and stays when its last thread leaves.
 */
export function useThreadGroups() {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const updateSettings = useUpdatePrimarySettings();
  const groups = useMemo(() => {
    let merged: ThreadGroups = NO_GROUPS;
    for (const config of serverConfigs.values()) {
      const own = config.settings.threadGroups;
      // The first environment to hold a group wins, so drift never flips a group's look.
      if (Object.keys(own).length > 0) merged = { ...own, ...merged };
    }
    return merged;
  }, [serverConfigs]);

  /** Saves a group, renaming its entry when `from` names another one. */
  const saveGroup = useCallback(
    (input: { from?: string; name: string; group: ThreadGroup }) => {
      const { [input.from ?? input.name]: _previous, ...rest } = groups;
      updateSettings({ threadGroups: { ...rest, [input.name]: input.group } });
    },
    [groups, updateSettings],
  );

  const deleteGroup = useCallback(
    (name: string) => {
      const { [name]: _deleted, ...rest } = groups;
      updateSettings({ threadGroups: rest });
    },
    [groups, updateSettings],
  );

  return { groups, saveGroup, deleteGroup };
}
