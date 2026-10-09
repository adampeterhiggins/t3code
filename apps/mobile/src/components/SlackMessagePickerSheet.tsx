import type { EnvironmentId, SlackMessageSummary, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { slackThreadContextRecord } from "@t3tools/shared/integrationContextRecords";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { relativeTime } from "../lib/time";
import { useEnvironmentServerConfig } from "../state/entities";
import { slackEnvironment } from "../state/slack";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  captureComposerDraftInsertion,
  insertComposerDraftContext,
  type ComposerDraftInsertion,
} from "../state/use-composer-drafts";
import { AppText as Text, AppTextInput } from "./AppText";
import { PickerSheet } from "./PickerSheet";

/** Slack allows about 20 searches a minute, so typing settles longer before it queries. */
const SEARCH_DEBOUNCE_MS = 400;

/** Slack's failures carry a reason; a rate limit deserves a clearer hint than its detail. */
function slackErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "Slack is busy. Try again shortly.";
    if (error.reason === "not-connected" || error.reason === "revoked") {
      return "Slack is not connected. Connect it from Settings > Integrations on desktop or web.";
    }
    if (error.reason === "not-found") return "That message is gone or not visible to you.";
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** Attach inserts the message's thread into a composer draft; link links it to the thread's tab group. */
export type SlackMessagePickerTarget =
  | { readonly mode?: "attach"; readonly environmentId: EnvironmentId; readonly draftKey: string }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

type OpenedSlackMessagePicker =
  | {
      readonly mode: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * A Slack message picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useSlackMessagePicker(target: SlackMessagePickerTarget | null): {
  readonly open: (() => void) | undefined;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedSlackMessagePicker | null>(null);
  const serverConfig = useEnvironmentServerConfig(target?.environmentId ?? null);
  const enabled = serverConfig?.settings.enableSlackIntegration === true;
  const openedServerConfig = useEnvironmentServerConfig(opened?.environmentId ?? null);
  return {
    open:
      target && enabled
        ? () =>
            setOpened(
              target.mode === "link"
                ? target
                : {
                    ...target,
                    mode: "attach",
                    insertion: captureComposerDraftInsertion(target.draftKey),
                  },
            )
        : undefined,
    sheet:
      opened && openedServerConfig?.settings.enableSlackIntegration ? (
        <SlackMessagePickerSheet {...opened} onClose={() => setOpened(null)} />
      ) : null,
  };
}

/**
 * Attaches a Slack thread at the caret the composer had when the sheet opened, or links it to the
 * thread's tab group. Mobile has no Slack settings, so an unconnected environment points at
 * desktop or web.
 */
function SlackMessagePickerSheet(
  props: OpenedSlackMessagePicker & { readonly onClose: () => void },
) {
  const connection = useEnvironmentQuery(
    slackEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <PickerSheet
      title={props.mode === "link" ? "Link Slack thread" : "Slack message"}
      onClose={props.onClose}
    >
      {phase === "connected" ? (
        <SlackMessageSearch {...props} />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {phase === undefined && !connection.error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              {connection.error ??
                "Slack is not connected on this environment. Connect it from Settings > Integrations on desktop or web."}
            </Text>
          )}
        </View>
      )}
    </PickerSheet>
  );
}

function SlackMessageSearch(props: OpenedSlackMessagePicker & { readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const getThread = useAtomCommand(slackEnvironment.getThread, {
    label: "slack thread fetch",
    reportFailure: false,
  });
  const linkThread = useAtomCommand(slackEnvironment.linkThread, {
    label: "slack thread link",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);

  const link = async (threadId: ThreadId, message: SlackMessageSummary) => {
    const result = await linkThread({
      environmentId: props.environmentId,
      input: {
        threadId,
        channelId: message.channelId,
        ts: message.ts,
        ...(message.threadTs === null ? {} : { threadTs: message.threadTs }),
        url: message.url,
      },
    });
    if (result._tag === "Failure") {
      Alert.alert(
        "Could not link Slack thread",
        slackErrorMessage(squashAtomCommandFailure(result), "Try again."),
      );
      return;
    }
    props.onClose();
  };

  const attach = async (message: SlackMessageSummary) => {
    if (attaching) return;
    setAttaching(message.url);
    try {
      if (props.mode === "link") {
        await link(props.threadId, message);
        return;
      }
      const fetched = await getThread({
        environmentId: props.environmentId,
        input: {
          channelId: message.channelId,
          ts: message.ts,
          threadTs: message.threadTs ?? undefined,
          url: message.url,
          scope: "thread",
        },
      });
      if (fetched._tag === "Failure") {
        Alert.alert(
          "Could not attach Slack message",
          slackErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
        );
        return;
      }
      const record = slackThreadContextRecord(fetched.value);
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
          accessibilityLabel="Search Slack messages"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search Slack"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {settled ? (
        <SlackMessageResults
          environmentId={props.environmentId}
          query={settled}
          pendingInput={settled !== trimmed}
          attaching={attaching}
          onPick={(message) => void attach(message)}
        />
      ) : (
        <View className="items-center p-6">
          {trimmed ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              Search Slack. Try in:#channel or from:@name
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Mounted only for a settled, non-empty query, so an empty box never spends a search. */
function SlackMessageResults(props: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly pendingInput: boolean;
  readonly attaching: string | null;
  readonly onPick: (message: SlackMessageSummary) => void;
}) {
  const insets = useSafeAreaInsets();
  const result = useAtomValue(
    slackEnvironment.messages({
      environmentId: props.environmentId,
      input: { query: props.query },
    }),
  );
  const messages = Option.getOrNull(AsyncResult.value(result))?.messages ?? [];
  const pending = props.pendingInput || result.waiting;
  const error =
    result._tag === "Failure"
      ? slackErrorMessage(Cause.squash(result.cause), "Could not search Slack.")
      : null;
  return (
    <FlatList
      data={messages}
      keyExtractor={(message) => message.url}
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
              {error ?? "No matching messages."}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.authorName} in ${item.channelLabel}: ${item.text}`}
          disabled={props.attaching !== null}
          onPress={() => props.onPick(item)}
          className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              <Text className="text-sm font-t3-semibold text-foreground">{item.authorName}</Text>
              {` · ${item.channelLabel} · ${relativeTime(item.postedAt)}`}
            </Text>
            <Text className="text-base text-foreground" numberOfLines={2}>
              {item.text}
            </Text>
          </View>
          {props.attaching === item.url ? <ActivityIndicator /> : null}
        </Pressable>
      )}
    />
  );
}
