import type {
  EnvironmentId,
  LinearIssueSummary,
  OrchestrationMessageContext,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { threadsForLinearIssue } from "@t3tools/client-runtime/state/linear";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  formatComposerContextReference,
  linearIssueContextRecord,
} from "@t3tools/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThreadShells } from "../state/entities";
import { linearEnvironment } from "../state/linear";
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

/** Linear allows 30 searches a minute, so typing settles before it queries. */
const SEARCH_DEBOUNCE_MS = 300;

/** Linear's failures carry a reason; a rate limit deserves a clearer hint than its detail. */
function linearErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "Linear is busy. Try again shortly.";
    if (error.reason === "not-connected" || error.reason === "revoked") {
      return "Linear is not connected. Connect it in Settings.";
    }
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/**
 * Attach inserts the issue into a composer draft; link links it to the thread's tab group. An
 * attach with `startFrom` starts a new thread from the issue: it first offers threads already
 * linked to it, and the thread the draft creates is linked once it sends.
 */
export type LinearIssuePickerTarget =
  | {
      readonly mode?: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly startFrom?: { readonly projectId: ProjectId };
    }
  | {
      readonly mode: "link";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    };

type OpenedLinearIssuePicker =
  | {
      readonly mode: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly startFrom?: { readonly projectId: ProjectId };
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** Issues picked to start a draft's thread from, by draft key, until the draft sends. */
const startFromIssueIds = new Map<string, string>();

/**
 * The issue the draft was started from, if its chip is still in the draft. Clears it: the caller
 * links the thread the draft just created.
 */
export function takeStartFromLinearIssue(
  draftKey: string,
  context: OrchestrationMessageContext | undefined,
): string | null {
  const issueId = startFromIssueIds.get(draftKey);
  startFromIssueIds.delete(draftKey);
  if (issueId === undefined) return null;
  const attached = context?.records.some(
    (record) => record.kind === "linear-issue" && "issueId" in record && record.issueId === issueId,
  );
  return attached ? issueId : null;
}

/**
 * A Linear issue picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useLinearIssuePicker(target: LinearIssuePickerTarget | null): {
  readonly open: () => void;
  readonly sheet: ReactNode;
} {
  const navigation = useNavigation();
  const connection = useEnvironmentQuery(
    target
      ? linearEnvironment.connection({ environmentId: target.environmentId, input: {} })
      : null,
  );
  const [opened, setOpened] = useState<OpenedLinearIssuePicker | null>(null);
  const open = () => {
    if (!target) return;
    // Connecting is a settings task; the picker only picks.
    if (connection.data && connection.data.phase !== "connected") {
      navigation.navigate("SettingsSheet", {
        screen: "SettingsContent",
        params: { screen: "SettingsLinear" },
      });
      return;
    }
    setOpened(
      target.mode === "link"
        ? target
        : {
            ...target,
            mode: "attach",
            insertion: captureComposerDraftInsertion(target.draftKey),
          },
    );
  };
  return {
    open,
    sheet: opened ? <LinearIssuePickerSheet {...opened} onClose={() => setOpened(null)} /> : null,
  };
}

/**
 * Attaches a Linear issue at the caret the composer had when the sheet opened, or links one to
 * the thread's tab group.
 */
function LinearIssuePickerSheet(props: OpenedLinearIssuePicker & { readonly onClose: () => void }) {
  const connection = useEnvironmentQuery(
    linearEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <PickerSheet
      title={
        props.mode === "link"
          ? "Link Linear issue"
          : props.startFrom
            ? "Start from issue"
            : "Linear issue"
      }
      onClose={props.onClose}
    >
      {phase === "connected" ? (
        <LinearIssueSearch {...props} />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {phase === undefined && !connection.error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              {connection.error ?? "Linear is not connected. Connect it in Settings > Linear."}
            </Text>
          )}
        </View>
      )}
    </PickerSheet>
  );
}

function LinearIssueSearch(props: OpenedLinearIssuePicker & { readonly onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const startFrom = props.mode === "attach" ? props.startFrom : undefined;
  const threadShells = useThreadShells();
  const threadLinks = useEnvironmentQuery(
    startFrom
      ? linearEnvironment.threadLinks({ environmentId: props.environmentId, input: {} })
      : null,
  ).data;
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  // An empty query lists the viewer's open assigned issues.
  const result = useAtomValue(
    linearEnvironment.issues({
      environmentId: props.environmentId,
      input: settled ? { query: settled } : {},
    }),
  );
  const getIssue = useAtomCommand(linearEnvironment.getIssue, {
    label: "linear issue fetch",
    reportFailure: false,
  });
  const linkThread = useAtomCommand(linearEnvironment.linkThread, {
    label: "linear thread link",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);
  const issues = Option.getOrNull(AsyncResult.value(result))?.issues ?? [];
  const pending = settled !== trimmed || result.waiting;
  const error =
    result._tag === "Failure"
      ? linearErrorMessage(Cause.squash(result.cause), "Could not load Linear issues.")
      : null;

  const pick = async (issue: LinearIssueSummary) => {
    if (attaching) return;
    if (startFrom) {
      const existing = threadsForLinearIssue(
        threadShells.filter(
          (thread) =>
            thread.environmentId === props.environmentId &&
            thread.projectId === startFrom.projectId,
        ),
        threadLinks,
        issue.id,
      );
      const choice = await confirmOpenExistingThread(issue.identifier, existing);
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

  const attach = async (issue: LinearIssueSummary) => {
    setAttaching(issue.id);
    try {
      if (props.mode === "link") {
        const linked = await linkThread({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, issueId: issue.id },
        });
        if (linked._tag === "Failure") {
          Alert.alert(
            "Could not link issue",
            linearErrorMessage(squashAtomCommandFailure(linked), "Try again."),
          );
          return;
        }
        props.onClose();
        return;
      }
      const fetched = await getIssue({
        environmentId: props.environmentId,
        input: { id: issue.id },
      });
      if (fetched._tag === "Failure") {
        Alert.alert(
          "Could not attach issue",
          linearErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
        );
        return;
      }
      const record = linearIssueContextRecord(fetched.value);
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
      if (startFrom) startFromIssueIds.set(props.draftKey, issue.id);
      props.onClose();
    } finally {
      setAttaching(null);
    }
  };

  return (
    <View className="flex-1">
      <View className="px-4 pb-3">
        <AppTextInput
          accessibilityLabel="Search Linear issues"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search, or paste ENG-123 or an issue link"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FlatList
        data={issues}
        keyExtractor={(issue) => issue.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListHeaderComponent={
          !trimmed && issues.length > 0 ? (
            <Text className="px-4 pb-2 text-sm text-foreground-muted">Assigned to you</Text>
          ) : undefined
        }
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
                {error ?? (trimmed ? "No matching issues." : "No open issues are assigned to you.")}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.identifier} ${item.title}, ${item.stateName}`}
            disabled={attaching !== null}
            onPress={() => void pick(item)}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-base text-foreground" numberOfLines={2}>
                {item.title}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {item.identifier} · {item.stateName}
              </Text>
            </View>
            {attaching === item.id ? <ActivityIndicator /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}
