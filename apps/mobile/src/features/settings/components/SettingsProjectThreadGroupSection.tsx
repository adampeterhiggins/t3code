import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { useNavigationThreadShells } from "../../../state/entities";
import { serverEnvironment, threadListEnvironmentsAtom } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { collectThreadGroupNames } from "../../threads/threadListV2";
import { useThreadGroups } from "../../threads/use-thread-groups";
import type { SettingsTarget } from "../settings-environment-filter";
import {
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
} from "../settings-scoped-server";
import { SettingsChoiceRow } from "./SettingsChoiceRow";
import { SettingsSection } from "./SettingsSection";

/**
 * The group the server puts every new thread of this project into: a project
 * override, written to each checkout whose server supports project overrides
 * and thread groups. Offers the same groups as Move to group.
 */
export function SettingsProjectThreadGroupSection(props: {
  readonly members: readonly EnvironmentProject[];
  readonly environments: readonly SettingsTarget[];
}) {
  const threads = useNavigationThreadShells();
  const { groupEnvironmentIds } = useAtomValue(threadListEnvironmentsAtom);
  const { groups } = useThreadGroups();
  const [pending, setPending] = useState(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "project thread group update",
    reportFailure: true,
  });
  const groupNames = useMemo(
    () => collectThreadGroupNames(threads, groupEnvironmentIds, Object.keys(groups)),
    [groupEnvironmentIds, groups, threads],
  );
  const targets = resolveMobileSettingsTargets(
    props.environments.filter(
      (environment) =>
        environment.serverConfig.environment.capabilities.projectSettingsOverrides === true &&
        environment.serverConfig.environment.capabilities.threadGroups === true,
    ),
    props.members,
  );
  if (targets.length === 0) return null;
  const current = uniformMobileSetting(targets, "defaultThreadGroup");

  // Null removes the override, so the environment default (no group) applies.
  const choose = (defaultThreadGroup: string | null) => {
    if (pending || defaultThreadGroup === current) return;
    const writes = planMobileScopedSettingsPatch(targets, true, { defaultThreadGroup });
    if (writes.length === 0) return;
    setPending(true);
    void Promise.allSettled(
      writes.map((entry) =>
        updateSettings({ environmentId: entry.environmentId, input: { patch: entry.patch } }),
      ),
    ).finally(() => setPending(false));
  };

  return (
    <SettingsSection title="Thread group">
      <SettingsChoiceRow
        label="None"
        description="New threads start outside any group."
        selected={current === null}
        separated={false}
        disabled={pending}
        onPress={() => choose(null)}
      />
      {groupNames.map((name) => (
        <SettingsChoiceRow
          key={name}
          label={name}
          description="New threads in this project join this group."
          selected={current === name}
          separated
          disabled={pending}
          onPress={() => choose(name)}
        />
      ))}
      {groupNames.length === 0 ? (
        <View className="px-4 pb-3">
          <Text className="text-sm text-foreground-muted">
            Create a group from a thread's menu or the thread list filter to choose it here.
          </Text>
        </View>
      ) : null}
    </SettingsSection>
  );
}
