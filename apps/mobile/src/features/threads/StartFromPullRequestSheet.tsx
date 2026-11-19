import { LegendList } from "@legendapp/list/react-native";
import { threadsForPullRequest } from "@t3tools/client-runtime/state/pull-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, PullRequestListEntry } from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { confirmOpenExistingThread } from "../../components/confirmOpenExistingThread";
import { PickerSheet } from "../../components/PickerSheet";
import { useThreadShells } from "../../state/entities";
import { gitEnvironment } from "../../state/git";
import { composerPullRequests } from "../../state/pull-requests";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

const SEARCH_DEBOUNCE_MS = 300;
const PULL_REQUEST_LIMIT = 50;

export interface StartFromPullRequestTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  /** Points the draft at the checkout the pull request is now on. */
  readonly onCheckout: (checkout: {
    readonly branch: string;
    readonly worktreePath: string | null;
  }) => void;
}

/** Starts a new thread's draft from one of the project's open pull requests. */
export function useStartFromPullRequestPicker(target: StartFromPullRequestTarget | null): {
  readonly open: () => void;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<StartFromPullRequestTarget | null>(null);
  return {
    open: () => setOpened(target),
    sheet: opened ? (
      <StartFromPullRequestSheet {...opened} onClose={() => setOpened(null)} />
    ) : null,
  };
}

/**
 * Checks a picked pull request out in its own worktree, or the worktree it is already checked
 * out in, like the web start-from picker. A pull request a live thread already works on offers
 * that thread first.
 */
function StartFromPullRequestSheet(
  props: StartFromPullRequestTarget & { readonly onClose: () => void },
) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const list = useEnvironmentQuery(
    composerPullRequests.list({
      environmentId: props.environmentId,
      input: {
        state: "open",
        projectId: props.projectId,
        limit: PULL_REQUEST_LIMIT,
        ...(settled ? { query: settled } : {}),
      },
    }),
  );
  const prepare = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    label: "start from pull request",
    reportFailure: false,
  });
  const projectThreads = useThreadShells().filter(
    (thread) =>
      thread.environmentId === props.environmentId && thread.projectId === props.projectId,
  );
  const entries = (list.data?.entries ?? []).filter((entry) => entry.projectId === props.projectId);
  const error = list.error ?? list.data?.errors[0]?.message ?? null;

  const checkOut = async (entry: PullRequestListEntry) => {
    setCheckingOut(entry.url);
    const result = await prepare({
      environmentId: props.environmentId,
      input: { cwd: props.workspaceRoot, reference: entry.url, mode: "worktree" },
    });
    setCheckingOut(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        Alert.alert(
          gt("Could not check out #{number}", { number: entry.number }),
          failure instanceof Error ? failure.message : undefined,
        );
      }
      return;
    }
    props.onCheckout({ branch: result.value.branch, worktreePath: result.value.worktreePath });
    props.onClose();
    if (!result.value.isOnPullRequestHead) {
      Alert.alert(
        gt("Checked out, but not on the latest commits"),
        gt(
          "The worktree holds uncommitted work or local commits, so it stays behind the pull request.",
        ),
      );
    }
  };

  const pick = async (entry: PullRequestListEntry) => {
    if (checkingOut) return;
    const choice = await confirmOpenExistingThread(
      `#${entry.number}`,
      threadsForPullRequest(projectThreads, entry),
    );
    if (choice === "cancel") return;
    if (choice === "start") {
      await checkOut(entry);
      return;
    }
    props.onClose();
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(choice.environmentId),
        threadId: String(choice.id),
      }),
    );
  };

  return (
    <PickerSheet title={gt("Start from pull request")} onClose={props.onClose}>
      <View className="px-4 pb-3">
        <AppTextInput
          accessibilityLabel={gt("Search pull requests")}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder={gt("Search open pull requests")}
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- PickerSheet is a Modal with an inline header; there is no navigation header to register with. */}
      <LegendList
        data={entries}
        keyExtractor={(entry) => entry.url}
        extraData={{ checkingOut, pick }}
        estimatedItemSize={64}
        recycleItems
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListEmptyComponent={
          <View className="items-center p-6">
            {list.isPending || settled !== trimmed ? (
              <ActivityIndicator />
            ) : (
              <Text
                selectable={error !== null}
                className={
                  error ? "text-center text-danger-foreground" : "text-center text-foreground-muted"
                }
              >
                {error ??
                  (trimmed ? gt("No matching pull requests.") : gt("No open pull requests."))}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const inUse = threadsForPullRequest(projectThreads, item).length > 0;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                inUse
                  ? gt("#{number} {title}, in use", { number: item.number, title: item.title })
                  : `#${item.number} ${item.title}`
              }
              disabled={checkingOut !== null}
              onPress={() => void pick(item)}
              className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
            >
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground" numberOfLines={2}>
                  {item.title}
                </Text>
                <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                  #{item.number}
                  {item.isDraft ? ` · ${gt("draft", { $context: "pull request state" })}` : ""}
                  {item.author ? ` · ${item.author.login}` : ""}
                  {inUse ? ` · ${gt("in use", { $context: "pull request has a thread" })}` : ""}
                </Text>
              </View>
              {checkingOut === item.url ? <ActivityIndicator /> : null}
            </Pressable>
          );
        }}
      />
    </PickerSheet>
  );
}
