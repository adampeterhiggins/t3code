import { createThreadTab, listThreadTabs } from "@t3tools/client-runtime/thread-tabs";
import {
  type EnvironmentId,
  type ModelSelection,
  ThreadId,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { runtime } from "../../lib/runtime";
import { uuidv4 } from "../../lib/uuid";
import { usePreparedConnection } from "../../state/session";

const selectedSources = new Map<string, ReadonlyArray<ThreadId>>();

export function selectedThreadTabSources(threadId: ThreadId): ReadonlyArray<ThreadId> {
  return selectedSources.get(threadId) ?? [];
}

export function clearSelectedThreadTabSources(threadId: ThreadId): void {
  selectedSources.delete(threadId);
}

export function ThreadTabs({
  environmentId,
  threadId,
  modelSelection,
  empty,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  modelSelection: ModelSelection;
  empty: boolean;
}) {
  const prepared = usePreparedConnection(environmentId);
  const navigation = useNavigation();
  const [group, setGroup] = useState<ThreadTabGroup | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<ThreadId>>(() =>
    selectedThreadTabSources(threadId),
  );
  const [busy, setBusy] = useState(false);

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
    <View className="border-b border-border px-3 py-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="items-center gap-2"
      >
        {group.tabs.map((tab) => (
          <Pressable key={tab.threadId} onPress={() => navigateTo(tab.threadId)}>
            <Text
              className={
                tab.threadId === threadId
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              }
            >
              {tab.title}
            </Text>
          </Pressable>
        ))}
        <Pressable disabled={busy} onPress={() => void create()}>
          <Text className="font-semibold text-foreground">+ Tab</Text>
        </Pressable>
      </ScrollView>
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
