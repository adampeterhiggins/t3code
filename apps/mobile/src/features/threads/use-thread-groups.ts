import { useAtomValue } from "@effect/atom-react";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import type { ThreadGroup } from "@t3tools/contracts/settings";
import { useCallback, useMemo } from "react";

import { useEnvironments } from "../../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { mergeThreadGroups, planThreadGroups } from "./thread-groups";

/** Merged registered groups, and a writer that sends the full map to every shared-settings target. */
export function useThreadGroups() {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const { environments } = useEnvironments();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "thread groups update",
    reportFailure: true,
  });
  const groups = useMemo(
    () =>
      mergeThreadGroups([...serverConfigs.values()].map((config) => config.settings.threadGroups)),
    [serverConfigs],
  );

  /** Registers or restyles one group, renaming it when `from` differs; null deletes it. */
  const setGroup = useCallback(
    (input: { from?: string; name: string; group: ThreadGroup | null }) => {
      const threadGroups = planThreadGroups(groups, input);
      if (threadGroups === null) return;
      for (const environment of environments) {
        if (!supportsSharedSettingsSync(environment)) continue;
        void updateSettings({
          environmentId: environment.environmentId,
          input: { patch: { threadGroups } },
        });
      }
    },
    [environments, groups, updateSettings],
  );

  return { groups, setGroup };
}
