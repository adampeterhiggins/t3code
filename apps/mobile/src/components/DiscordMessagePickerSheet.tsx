import type { DiscordMessageSummary, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { discordThreadContextRecord } from "@t3tools/shared/integrationContextRecords";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { relativeTime } from "../lib/time";
import { discordEnvironment } from "../state/discord";
import { useEnvironmentServerConfig } from "../state/entities";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  captureComposerDraftInsertion,
  insertComposerDraftContext,
  type ComposerDraftInsertion,
} from "../state/use-composer-drafts";
import { AppText as Text, AppTextInput } from "./ui/AppText";
import { PickerSheet } from "./PickerSheet";

/** Each search reads every server the bot is in, so typing settles before it queries. */
const SEARCH_DEBOUNCE_MS = 400;

/** Discord's failures carry a reason; a rate limit deserves a clearer hint than its detail. */
function discordErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "Discord is busy. Try again shortly.";
    if (error.reason === "not-connected" || error.reason === "revoked") {
      return "Discord is not connected. Connect it from Settings > Integrations on desktop or web.";
    }
    if (error.reason === "not-found") return "That message is gone or not visible to the bot.";
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** Attach inserts the message's thread into a composer draft; link links it to the thread's tab group. */
export type DiscordMessagePickerTarget =
  | { readonly mode?: "attach"; readonly environmentId: EnvironmentId; readonly draftKey: string }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

type OpenedDiscordMessagePicker =
  | {
      readonly mode: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * A Discord message picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useDiscordMessagePicker(target: DiscordMessagePickerTarget | null): {
  readonly open: (() => void) | undefined;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedDiscordMessagePicker | null>(null);
  const serverConfig = useEnvironmentServerConfig(target?.environmentId ?? null);
  const enabled = serverConfig?.settings.enableDiscordIntegration === true;
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
      opened && openedServerConfig?.settings.enableDiscordIntegration ? (
        <DiscordMessagePickerSheet {...opened} onClose={() => setOpened(null)} />
      ) : null,
  };
}

/**
 * Attaches a Discord thread at the caret the composer had when the sheet opened, or links it to
 * the thread's tab group. Mobile has no Discord settings, so an unconnected environment points at
 * desktop or web.
 */
function DiscordMessagePickerSheet(
  props: OpenedDiscordMessagePicker & { readonly onClose: () => void },
) {
  const connection = useEnvironmentQuery(
    discordEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <PickerSheet
      title={props.mode === "link" ? "Link Discord thread" : "Discord message"}
      onClose={props.onClose}
    >
      {phase === "connected" ? (
        <DiscordMessageSearch {...props} />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {phase === undefined && !connection.error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              {connection.error ??
                "Discord is not connected on this environment. Connect it from Settings > Integrations on desktop or web."}
            </Text>
          )}
        </View>
      )}
    </PickerSheet>
  );
}

function DiscordMessageSearch(
  props: OpenedDiscordMessagePicker & { readonly onClose: () => void },
) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const getThread = useAtomCommand(discordEnvironment.getThread, {
    label: "discord thread fetch",
    reportFailure: false,
  });
  const linkThread = useAtomCommand(discordEnvironment.linkThread, {
    label: "discord thread link",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);

  const link = async (threadId: ThreadId, message: DiscordMessageSummary) => {
    const result = await linkThread({
      environmentId: props.environmentId,
      input: {
        threadId,
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.messageId,
        url: message.url,
      },
    });
    if (result._tag === "Failure") {
      Alert.alert(
        "Could not link Discord thread",
        discordErrorMessage(squashAtomCommandFailure(result), "Try again."),
      );
      return;
    }
    props.onClose();
  };

  const attach = async (message: DiscordMessageSummary) => {
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
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.messageId,
          url: message.url,
          scope: "thread",
        },
      });
      if (fetched._tag === "Failure") {
        Alert.alert(
          "Could not attach Discord message",
          discordErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
        );
        return;
      }
      const record = discordThreadContextRecord(fetched.value);
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
          accessibilityLabel="Search Discord messages"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search Discord"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {settled ? (
        <DiscordMessageResults
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
              Search messages in every server the bot is in.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Mounted only for a settled, non-empty query, so an empty box never spends a search. */
function DiscordMessageResults(props: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly pendingInput: boolean;
  readonly attaching: string | null;
  readonly onPick: (message: DiscordMessageSummary) => void;
}) {
  const insets = useSafeAreaInsets();
  const result = useAtomValue(
    discordEnvironment.messages({
      environmentId: props.environmentId,
      input: { query: props.query },
    }),
  );
  const messages = Option.getOrNull(AsyncResult.value(result))?.messages ?? [];
  const pending = props.pendingInput || result.waiting;
  const error =
    result._tag === "Failure"
      ? discordErrorMessage(Cause.squash(result.cause), "Could not search Discord.")
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
