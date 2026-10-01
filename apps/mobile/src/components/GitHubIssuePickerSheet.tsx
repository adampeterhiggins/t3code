import type {
  EnvironmentId,
  GitHubIssueStateFilter,
  GitHubIssueSummary,
  OrchestrationMessageContext,
  ProjectId,
} from "@t3tools/contracts";
import {
  gitHubIssueContextRecord,
  gitHubIssueLabel,
  threadsForGitHubIssue,
} from "@t3tools/client-runtime/state/github-issues";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThreadShells } from "../state/entities";
import { gitHubIssueEnvironment } from "../state/githubIssues";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  captureComposerDraftInsertion,
  insertComposerDraftContext,
  type ComposerDraftInsertion,
} from "../state/use-composer-drafts";
import { confirmOpenExistingThread } from "./confirmOpenExistingThread";
import { AppText as Text, AppTextInput } from "./AppText";
import { PickerSheet } from "./PickerSheet";
import { SegmentedControl } from "./SegmentedControl";

/** Each search runs `gh` on the host, so typing settles before it queries. */
const SEARCH_DEBOUNCE_MS = 300;

const STATE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const satisfies ReadonlyArray<{ value: GitHubIssueStateFilter; label: string }>;

/** GitHub's failures carry a reason; the host's `gh` setup deserves a clearer hint than its detail. */
function gitHubIssueErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "GitHub is busy. Try again shortly.";
    if (error.reason === "unavailable") {
      return "The GitHub CLI (gh) is not installed on the computer running T3 Code.";
    }
    if (error.reason === "not-authenticated") {
      return "The GitHub CLI is not signed in. Run `gh auth login` on the computer running T3 Code.";
    }
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/**
 * Attach inserts the issue into a composer draft. `cwd` is the checkout whose repository lists
 * issues. With `startFrom` it starts a new thread from the issue: it first offers threads already
 * linked to it, and the thread the draft creates is linked once it sends.
 */
export interface GitHubIssuePickerTarget {
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  readonly cwd: string;
  readonly startFrom?: { readonly projectId: ProjectId };
}

type OpenedGitHubIssuePicker = GitHubIssuePickerTarget & {
  readonly insertion: ComposerDraftInsertion;
};

/** Issues picked to start a draft's thread from, by draft key, until the draft sends. */
const startFromIssueUrls = new Map<string, string>();

/**
 * The issue URL the draft was started from, if its chip is still in the draft. Clears it: the
 * caller links the thread the draft just created.
 */
export function takeStartFromGitHubIssue(
  draftKey: string,
  context: OrchestrationMessageContext | undefined,
): string | null {
  const url = startFromIssueUrls.get(draftKey);
  startFromIssueUrls.delete(draftKey);
  if (url === undefined) return null;
  const attached = context?.records.some(
    (record) => record.kind === "github-issue" && "url" in record && record.url === url,
  );
  return attached ? url : null;
}

/**
 * A GitHub issue picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useGitHubIssuePicker(target: GitHubIssuePickerTarget | null): {
  readonly open: () => void;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedGitHubIssuePicker | null>(null);
  return {
    open: () => {
      if (target) {
        setOpened({ ...target, insertion: captureComposerDraftInsertion(target.draftKey) });
      }
    },
    sheet: opened ? <GitHubIssuePickerSheet {...opened} onClose={() => setOpened(null)} /> : null,
  };
}

/** Attaches a GitHub issue at the caret the composer had when the sheet opened. */
function GitHubIssuePickerSheet(props: OpenedGitHubIssuePicker & { readonly onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { startFrom } = props;
  const [query, setQuery] = useState("");
  const [state, setState] = useState<GitHubIssueStateFilter>("open");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const result = useAtomValue(
    gitHubIssueEnvironment.issues({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, state, ...(settled ? { query: settled } : {}) },
    }),
  );
  const threadLinks = useEnvironmentQuery(
    gitHubIssueEnvironment.threadLinks({ environmentId: props.environmentId, input: {} }),
  ).data;
  // Starting from an issue offers the project's threads; attaching only marks issues in use.
  const candidateThreads = useThreadShells().filter(
    (thread) =>
      thread.environmentId === props.environmentId &&
      (!startFrom || thread.projectId === startFrom.projectId),
  );
  const getIssue = useAtomCommand(gitHubIssueEnvironment.getIssue, {
    label: "github issue fetch",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);
  const issues = Option.getOrNull(AsyncResult.value(result))?.issues ?? [];
  const pending = settled !== trimmed || result.waiting;
  const error =
    result._tag === "Failure"
      ? gitHubIssueErrorMessage(Cause.squash(result.cause), "Could not load GitHub issues.")
      : null;

  const pick = async (issue: GitHubIssueSummary) => {
    if (attaching) return;
    if (startFrom) {
      const choice = await confirmOpenExistingThread(
        gitHubIssueLabel(issue),
        threadsForGitHubIssue(candidateThreads, threadLinks, issue.url),
      );
      if (choice === "cancel") return;
      if (choice !== "start") {
        props.onClose();
        navigation.dispatch(
          StackActions.replace("Thread", {
            environmentId: String(choice.environmentId),
            threadId: String(choice.id),
          }),
        );
        return;
      }
    }
    await attach(issue);
  };

  const attach = async (issue: GitHubIssueSummary) => {
    setAttaching(issue.url);
    try {
      const fetched = await getIssue({
        environmentId: props.environmentId,
        input: { url: issue.url },
      });
      if (fetched._tag === "Failure") {
        Alert.alert(
          "Could not attach issue",
          gitHubIssueErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
        );
        return;
      }
      const record = gitHubIssueContextRecord(fetched.value);
      if (
        !insertComposerDraftContext(
          props.draftKey,
          {
            text: formatComposerContextReference(record),
            context: { version: 1, records: [record] },
          },
          props.insertion,
        )
      ) {
        Alert.alert("Too many context items", "Remove some context from the draft and try again.");
        return;
      }
      if (startFrom) startFromIssueUrls.set(props.draftKey, issue.url);
      props.onClose();
    } finally {
      setAttaching(null);
    }
  };

  return (
    <PickerSheet title={startFrom ? "Start from issue" : "GitHub issue"} onClose={props.onClose}>
      <View className="gap-3 px-4 pb-3">
        <AppTextInput
          accessibilityLabel="Search GitHub issues"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search, or paste #123 or an issue link"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
        <SegmentedControl
          options={STATE_OPTIONS}
          selected={state}
          onSelect={setState}
          size="compact"
        />
      </View>
      <FlatList
        data={issues}
        keyExtractor={(issue) => issue.url}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListEmptyComponent={
          <View className="items-center p-6">
            {pending ? (
              <ActivityIndicator />
            ) : (
              <Text
                selectable={error !== null}
                className={
                  error ? "text-center text-danger-foreground" : "text-center text-foreground-muted"
                }
              >
                {error ?? (trimmed ? "No matching issues." : "No issues.")}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const inUse = threadsForGitHubIssue(candidateThreads, threadLinks, item.url).length > 0;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${gitHubIssueLabel(item)} ${item.title}, ${item.state}${inUse ? ", in use" : ""}`}
              disabled={attaching !== null}
              onPress={() => void pick(item)}
              className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
            >
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground" numberOfLines={2}>
                  {item.title}
                </Text>
                <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                  {gitHubIssueLabel(item)} · {item.state === "open" ? "Open" : "Closed"}
                  {inUse ? " · In use" : ""}
                </Text>
              </View>
              {attaching === item.url ? <ActivityIndicator /> : null}
            </Pressable>
          );
        }}
      />
    </PickerSheet>
  );
}
