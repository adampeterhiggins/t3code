import { createThreadTab, listThreadTabs } from "@t3tools/client-runtime/thread-tabs";
import {
  type EnvironmentId,
  type ModelSelection,
  ThreadId,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { useLinearIssuePicker } from "../../components/LinearIssuePickerSheet";
import { runtime } from "../../lib/runtime";
import { uuidv4 } from "../../lib/uuid";
import { usePreparedConnection } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { refreshArchivedThreadsForEnvironment } from "../archive/useArchivedThreadSnapshots";
import {
  ThreadLinearLinkButton,
  ThreadLinearLinkChip,
  useThreadLinearLink,
} from "./ThreadLinearLink";

const NEW_TAB_ACTION = "tab:new";
const CLOSE_TAB_ACTION = "tab:close";
const LINK_LINEAR_ACTION = "tab:link-linear";

const selectedSources = new Map<string, ReadonlyArray<ThreadId>>();

export function selectedThreadTabSources(threadId: ThreadId): ReadonlyArray<ThreadId> {
  return selectedSources.get(threadId) ?? [];
}

export function clearSelectedThreadTabSources(threadId: ThreadId): void {
  selectedSources.delete(threadId);
}

/**
 * Switches, opens, and closes a thread's chat tabs; empty tabs also pick sibling context. The
 * group's linked Linear issue sits beside the switcher.
 */
export function ThreadTabs({
  environmentId,
  threadId,
  title,
  modelSelection,
  empty,
  working,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  title: string;
  modelSelection: ModelSelection;
  empty: boolean;
  working: boolean;
}) {
  const prepared = usePreparedConnection(environmentId);
  const navigation = useNavigation();
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const [group, setGroup] = useState<ThreadTabGroup | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<ThreadId>>(() =>
    selectedThreadTabSources(threadId),
  );
  const [busy, setBusy] = useState(false);
  const linear = useThreadLinearLink(environmentId, threadId);
  const linearPicker = useLinearIssuePicker({ mode: "link", environmentId, threadId });

  useEffect(() => {
    if (Option.isNone(prepared)) return;
    let active = true;
    void runtime.runPromise(listThreadTabs(prepared.value, threadId)).then(
      (next) => {
        if (active) setGroup(next);
      },
      () => {
        if (active) setGroup(null);
      },
    );
    return () => {
      active = false;
    };
  }, [prepared, threadId]);

  if (!group || Option.isNone(prepared)) return null;

  const navigateTo = (target: ThreadId) => {
    navigation.navigate("Thread", {
      environmentId: String(environmentId),
      threadId: String(target),
    });
  };
  const create = async () => {
    setBusy(true);
    try {
      const next = ThreadId.make(uuidv4());
      await runtime.runPromise(
        createThreadTab(prepared.value, threadId, {
          threadId: next,
          modelSelection,
        }),
      );
      navigateTo(next);
    } catch (cause) {
      Alert.alert("Could not create tab", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  // Closing archives the tab's thread, so the archived-threads list can reopen it.
  const close = async () => {
    const index = group.tabs.findIndex((tab) => tab.threadId === threadId);
    const next = group.tabs[index + 1] ?? group.tabs[index - 1];
    if (!next) return;
    if (working) {
      Alert.alert(
        "Could not close tab",
        "This tab is working. Interrupt it first, then try again.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await archive({ environmentId, input: { threadId } });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert("Could not close tab", error instanceof Error ? error.message : undefined);
        return;
      }
      refreshArchivedThreadsForEnvironment(environmentId);
      navigateTo(next.threadId);
    } finally {
      setBusy(false);
    }
  };
  const onMenuAction = (id: string) => {
    if (id === NEW_TAB_ACTION) void create();
    else if (id === CLOSE_TAB_ACTION) void close();
    else if (id === LINK_LINEAR_ACTION) linearPicker.open();
    else if (id !== threadId) navigateTo(ThreadId.make(id));
  };
  const toggle = (sourceId: ThreadId) => {
    if (!selected.includes(sourceId) && selected.length >= 8) {
      Alert.alert("Select up to eight chats for context.");
      return;
    }
    const next = selected.includes(sourceId)
      ? selected.filter((id) => id !== sourceId)
      : [...selected, sourceId];
    setSelected(next);
    selectedSources.set(threadId, next);
  };

  return (
    <View className="border-b border-border px-3 py-1.5">
      <View className="flex-row items-center gap-2">
        {group.tabs.length <= 1 ? (
          // A lone tab would repeat the thread title, so the switcher is just a "new tab" action.
          <Pressable
            accessibilityLabel="New tab"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void create()}
            className="flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1.5 active:opacity-70 disabled:opacity-50"
          >
            <SymbolView name="plus" size={13} tintColorClassName="accent-foreground" />
            <Text className="text-sm font-medium text-foreground">New tab</Text>
          </Pressable>
        ) : (
          <ControlPillMenu
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Chat tab: ${title}`}
            title="Tabs"
            // Long titles shrink so the linked issue beside the switcher stays visible.
            style={{ flexShrink: 1, minWidth: 0 }}
            actions={[
              ...group.tabs.map((tab) => ({
                id: tab.threadId,
                title: tab.threadId === threadId ? title : tab.title,
                state: tab.threadId === threadId ? ("on" as const) : ("off" as const),
              })),
              { id: NEW_TAB_ACTION, title: "New tab", image: "plus" },
              { id: CLOSE_TAB_ACTION, title: "Close tab", image: "xmark" },
              ...(linear.canLink
                ? [{ id: LINK_LINEAR_ACTION, title: "Link Linear issue", image: "link" }]
                : []),
            ]}
            onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
          >
            <Pressable
              accessibilityLabel={`Chat tab: ${title}`}
              accessibilityRole="button"
              disabled={busy}
              className="min-w-0 shrink flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1.5 active:opacity-70 disabled:opacity-50"
            >
              <Text numberOfLines={1} className="shrink text-sm font-medium text-foreground">
                {title}
              </Text>
              <Text className="text-sm text-muted-foreground">{group.tabs.length}</Text>
              <SymbolView name="chevron.down" size={11} tintColorClassName="accent-foreground" />
            </Pressable>
          </ControlPillMenu>
        )}
        {linear.link ? (
          <ThreadLinearLinkChip
            environmentId={environmentId}
            threadId={threadId}
            link={linear.link}
            onChange={linearPicker.open}
          />
        ) : linear.canLink && group.tabs.length <= 1 ? (
          <ThreadLinearLinkButton onPress={linearPicker.open} />
        ) : null}
      </View>
      {linearPicker.sheet}
      {empty && group.tabs.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="items-center gap-2 pt-2"
        >
          <Text className="text-xs text-muted-foreground">Include context from:</Text>
          {group.tabs
            .filter((tab) => tab.threadId !== threadId)
            .map((tab) => (
              <Pressable
                key={tab.threadId}
                accessibilityRole="button"
                accessibilityState={{ selected: selected.includes(tab.threadId) }}
                onPress={() => toggle(tab.threadId)}
              >
                <Text
                  className={
                    selected.includes(tab.threadId)
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {tab.title}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
