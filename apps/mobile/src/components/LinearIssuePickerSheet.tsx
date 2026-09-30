import type { EnvironmentId, LinearIssueSummary, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { linearIssueContextRecord } from "@t3tools/client-runtime/state/linear";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useNavigation } from "@react-navigation/native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { linearEnvironment } from "../state/linear";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  captureComposerDraftInsertion,
  insertComposerDraftContext,
  type ComposerDraftInsertion,
} from "../state/use-composer-drafts";
import { AppText as Text, AppTextInput } from "./AppText";

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

/** Attach inserts the issue into a composer draft; link links it to the thread's tab group. */
export type LinearIssuePickerTarget =
  | {
      readonly mode?: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
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
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

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
  const insets = useSafeAreaInsets();
  const connection = useEnvironmentQuery(
    linearEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <Modal presentationStyle="pageSheet" animationType="slide" onRequestClose={props.onClose}>
      <View
        className="flex-1 bg-sheet-solid"
        style={
          Platform.OS === "android"
            ? { paddingTop: insets.top, paddingBottom: insets.bottom }
            : undefined
        }
      >
        <View className="flex-row items-center justify-between p-4">
          <Text className="text-lg text-foreground">
            {props.mode === "link" ? "Link Linear issue" : "Linear issue"}
          </Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} className="p-3">
            <Text className="text-foreground">Cancel</Text>
          </Pressable>
        </View>
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
      </View>
    </Modal>
  );
}

function LinearIssueSearch(props: OpenedLinearIssuePicker & { readonly onClose: () => void }) {
  const insets = useSafeAreaInsets();
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

  const attach = async (issue: LinearIssueSummary) => {
    if (attaching) return;
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
          ) : null
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
            onPress={() => void attach(item)}
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
