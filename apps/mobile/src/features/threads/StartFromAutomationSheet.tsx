import { openSettings } from "../settings/settings-navigation";
import { useAtomValue } from "@effect/atom-react";
import {
  automationRunBlocker,
  automationsForPicker,
} from "@t3tools/client-runtime/scheduled-task-picker";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickerSheet } from "../../components/PickerSheet";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { startScheduledTaskEditor } from "../settings/scheduled-task-editor-state";
import {
  type ComposerTaskSource,
  draftFromComposer,
  editDraft,
} from "../settings/scheduledTaskDraft";
import { describeSchedule } from "../settings/scheduledTaskPresentation";

export interface StartFromAutomationTarget {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly projectId: ProjectId;
  /** What the composer holds, read when a new automation is started from it. */
  readonly readSource: () => ComposerTaskSource | null;
}

/** Runs one of the project's scheduled tasks now, or starts a new one from the draft. */
export function useStartFromAutomationPicker(target: StartFromAutomationTarget | null): {
  readonly open: () => void;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<StartFromAutomationTarget | null>(null);
  return {
    open: () => setOpened(target),
    sheet: opened ? <StartFromAutomationSheet {...opened} onClose={() => setOpened(null)} /> : null,
  };
}

/**
 * Like the web start-from picker's Automations tab: a task runs as Run now does, then the thread
 * it ran in opens. The edit button and the new-from-draft row open the settings form.
 */
function StartFromAutomationSheet(
  props: StartFromAutomationTarget & { readonly onClose: () => void },
) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const list = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const canRun = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(props.environmentId),
  );
  const canEdit = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(props.environmentId),
  );
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "scheduled task run",
    reportFailure: false,
  });
  const tasks = automationsForPicker(list.data?.tasks ?? [], props.projectId, query);

  const openEditor = (
    editor: Parameters<typeof startScheduledTaskEditor>[0],
    prefilled: boolean,
  ) => {
    startScheduledTaskEditor(editor);
    props.onClose();
    if (prefilled) openSettings(navigation, "SettingsScheduledTaskNew", { prefilled: true });
    else openSettings(navigation, "SettingsScheduledTaskEdit");
  };

  const newFromDraft = () => {
    const source = props.readSource();
    if (source === null) return;
    const { draft, note } = draftFromComposer(source);
    openEditor(
      { environmentId: props.environmentId, environmentLabel: props.environmentLabel, draft, note },
      true,
    );
  };

  const run = async (task: ScheduledTask) => {
    if (running || !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)) {
      return;
    }
    setRunning(task.id);
    const result = await runNow({ environmentId: props.environmentId, input: { id: task.id } });
    setRunning(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        Dialog.alert(`Could not run ${task.title}`, String(squashAtomCommandFailure(result)));
      }
      return;
    }
    // Null means the run could not be dispatched; older servers do not report the thread.
    const threadId = result.value.threadId;
    if (threadId === null) {
      Dialog.alert(`Could not run ${task.title}`, result.value.task.lastRunError ?? undefined);
      return;
    }
    props.onClose();
    if (threadId !== undefined) {
      navigation.dispatch(
        StackActions.replace("Thread", {
          environmentId: String(props.environmentId),
          threadId: String(threadId),
        }),
      );
    }
  };

  return (
    <PickerSheet title="Start from automation" onClose={props.onClose}>
      <View className="px-4 pb-3">
        <AppTextInput
          accessibilityLabel="Search automations"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search automations"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListHeaderComponent={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New automation from draft"
            disabled={!canEdit || running !== null}
            onPress={newFromDraft}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
          >
            <SymbolView name="plus" size={16} tintColorClassName="accent-icon" />
            <Text className="text-base text-foreground">New automation from draft</Text>
          </Pressable>
        }
        ListEmptyComponent={
          <View className="items-center p-6">
            {list.data === null && list.error === null ? (
              <ActivityIndicator />
            ) : (
              <Text
                selectable={list.error !== null}
                className={
                  list.error
                    ? "text-center text-danger-foreground"
                    : "text-center text-foreground-muted"
                }
              >
                {list.error ??
                  (query.trim()
                    ? "No matching automations."
                    : "No automations in this project yet.")}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const blocker = automationRunBlocker(item);
          const status = [
            describeSchedule(item),
            item.enabled ? null : "paused",
            item.lastRunStatus === "failed" ? "last run failed" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <View className="flex-row items-center">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Run ${item.title} now`}
                accessibilityHint={blocker ?? undefined}
                disabled={!canRun || running !== null || blocker !== null}
                onPress={() => void run(item)}
                className="min-w-0 flex-1 flex-row items-center gap-3 py-3 ps-4 active:bg-subtle disabled:opacity-60"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-base text-foreground" numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                    {blocker ?? status}
                  </Text>
                </View>
                {running === item.id ? <ActivityIndicator /> : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.title}`}
                disabled={!canEdit || running !== null}
                onPress={() =>
                  openEditor(
                    {
                      environmentId: props.environmentId,
                      environmentLabel: props.environmentLabel,
                      draft: editDraft(item),
                    },
                    false,
                  )
                }
                className="size-11 items-center justify-center active:bg-subtle disabled:opacity-60"
              >
                <SymbolView name="pencil" size={16} tintColorClassName="accent-icon-muted" />
              </Pressable>
            </View>
          );
        }}
      />
    </PickerSheet>
  );
}
