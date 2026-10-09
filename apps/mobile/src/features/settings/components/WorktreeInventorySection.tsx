import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId, type ManagedWorktree } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsActionRow } from "./SettingsActionRow";
import { SettingsSection } from "./SettingsSection";

const listWorktrees = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:list-worktrees",
  tag: WS_METHODS.worktreesList,
});
const sizeWorktree = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:size-worktree",
  tag: WS_METHODS.worktreesSize,
});
const removeWorktrees = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:remove-worktrees",
  tag: WS_METHODS.worktreesRemove,
});

export function WorktreeInventorySection({ environmentId }: { environmentId: EnvironmentId }) {
  const list = useAtomCommand(listWorktrees);
  const size = useAtomCommand(sizeWorktree);
  const remove = useAtomCommand(removeWorktrees);
  const canRemove = useAtomValue(removeWorktrees.permissionAtom(environmentId));
  const [entries, setEntries] = useState<readonly ManagedWorktree[]>([]);
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Load worktrees to review storage on this machine.");
  const refresh = async () => {
    setBusy(true);
    const result = await list({ environmentId, input: {} });
    setBusy(false);
    if (result._tag === "Success") {
      setEntries(result.value.worktrees);
      setNotice(
        result.value.worktrees.length
          ? "Branches and thread history are kept when you remove a worktree."
          : "No managed worktrees.",
      );
    } else setNotice("Could not load worktrees.");
  };
  const prune = (paths: readonly string[]) =>
    Alert.alert(
      "Remove worktrees?",
      `Remove ${paths.length} clean worktree${paths.length === 1 ? "" : "s"} from this machine? Branches and thread history are kept. Running work and local changes are protected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void remove({ environmentId, input: { paths } }).then(async (result) => {
              await refresh();
              if (result._tag === "Success") {
                const removed = result.value.results.filter(
                  (entry) => entry.outcome === "removed",
                ).length;
                setNotice(`Removed ${removed}; kept ${result.value.results.length - removed}.`);
              } else setNotice("Could not remove worktrees.");
            });
          },
        },
      ],
    );
  const eligible = entries.filter(
    (entry) => entry.dirty === false && !entry.threads.some((thread) => thread.running),
  );
  return (
    <SettingsSection title="Managed worktrees">
      <Text className="p-4 text-sm text-muted-foreground">{notice}</Text>
      <SettingsActionRow
        icon="arrow.clockwise"
        label="Refresh worktrees"
        disabled={busy}
        loading={busy}
        onPress={() => void refresh()}
      />
      {eligible.length > 0 && (
        <SettingsActionRow
          icon="trash"
          tone="danger"
          label={`Remove clean worktrees (${Math.min(eligible.length, 200)})`}
          disabled={busy || !canRemove}
          onPress={() => prune(eligible.slice(0, 200).map((entry) => entry.path))}
        />
      )}
      {entries.map((entry) => {
        const running = entry.threads.some((thread) => thread.running);
        const bytes = sizes[entry.path];
        return (
          <View key={entry.path}>
            <Text className="px-4 pt-4 text-base text-foreground">
              {entry.repositoryName} · {entry.branch ?? "Unknown branch"}
            </Text>
            <Text className="px-4 text-sm text-muted-foreground">
              {entry.path}
              {"\n"}
              {entry.state} ·{" "}
              {running
                ? "Running — protected"
                : entry.dirty === false
                  ? "Clean"
                  : "Changes or status unknown — protected"}
              {"\n"}
              {entry.threads.map((thread) => `${thread.title} · ${thread.state}`).join("\n")}
            </Text>
            {entry.pullRequest && (
              <SettingsActionRow
                icon="link"
                label={`PR #${entry.pullRequest.number} · ${entry.pullRequest.state ?? "State not synced"}`}
                onPress={() => {
                  if (entry.pullRequest) void Linking.openURL(entry.pullRequest.url);
                }}
              />
            )}
            <SettingsActionRow
              icon="internaldrive"
              label={
                bytes === undefined
                  ? "Measure size"
                  : bytes === null
                    ? "Size unavailable · retry"
                    : `${(bytes / 1024 / 1024).toFixed(1)} MiB · refresh size`
              }
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void size({ environmentId, input: { path: entry.path } }).then((result) => {
                  setBusy(false);
                  setSizes((values) => ({
                    ...values,
                    [entry.path]: result._tag === "Success" ? result.value.bytes : null,
                  }));
                });
              }}
            />
            <SettingsActionRow
              icon="trash"
              tone="danger"
              label="Remove worktree"
              disabled={busy || !canRemove || running || entry.dirty !== false}
              onPress={() => prune([entry.path])}
            />
          </View>
        );
      })}
    </SettingsSection>
  );
}
