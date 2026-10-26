import type { EnvironmentId, GoogleFileSummary, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { googleFileContextRecord } from "@t3tools/client-runtime/state/google";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { relativeTime } from "../lib/time";
import { useEnvironmentServerConfig } from "../state/entities";
import { googleEnvironment } from "../state/google";
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

/** Google allows search request quotas, so typing settles longer before it queries. */
const SEARCH_DEBOUNCE_MS = 400;

/** Google's failures carry a reason; a rate limit deserves a clearer hint than its detail. */
function googleErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "Google is busy. Try again shortly.";
    if (error.reason === "not-connected" || error.reason === "revoked") {
      return "Google is not connected. Connect it from Settings > Integrations on desktop or web.";
    }
    if (error.reason === "not-found")
      return "Check that the connected Google account can open this document.";
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** Attach inserts the page into a composer draft; link links it to the thread's tab group. */
export type GoogleFilePickerTarget =
  | { readonly mode?: "attach"; readonly environmentId: EnvironmentId; readonly draftKey: string }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

type OpenedGoogleFilePicker =
  | {
      readonly mode: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * A Google file or event picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useGoogleFilePicker(target: GoogleFilePickerTarget | null): {
  readonly open: (() => void) | undefined;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedGoogleFilePicker | null>(null);
  const serverConfig = useEnvironmentServerConfig(target?.environmentId ?? null);
  const enabled = serverConfig?.settings.enableGoogleIntegration === true;
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
      opened && openedServerConfig?.settings.enableGoogleIntegration ? (
        <GoogleFilePickerSheet {...opened} onClose={() => setOpened(null)} />
      ) : null,
  };
}

/**
 * Attaches a Google file or event at the caret the composer had when the sheet opened, or links it to the
 * thread's tab group. Mobile has no Google settings, so an unconnected environment points at
 * desktop or web.
 */
function GoogleFilePickerSheet(props: OpenedGoogleFilePicker & { readonly onClose: () => void }) {
  const connection = useEnvironmentQuery(
    googleEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <PickerSheet
      title={props.mode === "link" ? "Link Google file or event" : "Google file or event"}
      onClose={props.onClose}
    >
      {phase === "connected" ? (
        <GoogleFileSearch {...props} />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {phase === undefined && !connection.error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              {connection.error ??
                "Google is not connected on this environment. Connect it from Settings > Integrations on desktop or web."}
            </Text>
          )}
        </View>
      )}
    </PickerSheet>
  );
}

function GoogleFileSearch(props: OpenedGoogleFilePicker & { readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const getFile = useAtomCommand(googleEnvironment.getFile, {
    label: "google page fetch",
    reportFailure: false,
  });
  const linkThread = useAtomCommand(googleEnvironment.linkThread, {
    label: "google thread link",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);

  const link = async (threadId: ThreadId, page: GoogleFileSummary) => {
    const result = await linkThread({
      environmentId: props.environmentId,
      input: { threadId, fileId: page.url },
    });
    if (result._tag === "Failure") {
      Alert.alert(
        "Could not link Google file or event",
        googleErrorMessage(squashAtomCommandFailure(result), "Try again."),
      );
      return;
    }
    props.onClose();
  };

  const attachSelected = async (page: GoogleFileSummary) => {
    if (props.mode === "link") {
      await link(props.threadId, page);
      return;
    }
    const fetched = await getFile({
      environmentId: props.environmentId,
      input: { id: page.url },
    });
    if (fetched._tag === "Failure") {
      Alert.alert(
        "Could not attach Google file or event",
        googleErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
      );
      return;
    }
    const record = googleFileContextRecord(fetched.value);
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
  };

  const attach = async (page: GoogleFileSummary) => {
    if (attaching) return;
    setAttaching(page.url);
    await attachSelected(page).finally(() => setAttaching(null));
  };

  return (
    <View className="flex-1">
      <View className="px-4 pb-3">
        <AppTextInput
          accessibilityLabel="Search Google files"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search Google"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {settled ? (
        <GoogleFileResults
          environmentId={props.environmentId}
          query={settled}
          pendingInput={settled !== trimmed}
          attaching={attaching}
          onPick={(page) => void attach(page)}
        />
      ) : (
        <View className="items-center p-6">
          {trimmed ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              Search files and events by title or paste a Google link.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Mounted only for a settled, non-empty query, so an empty box never spends a search. */
function GoogleFileResults(props: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly pendingInput: boolean;
  readonly attaching: string | null;
  readonly onPick: (page: GoogleFileSummary) => void;
}) {
  const insets = useSafeAreaInsets();
  const result = useAtomValue(
    googleEnvironment.files({
      environmentId: props.environmentId,
      input: { query: props.query, source: "all" },
    }),
  );
  const files = Option.getOrNull(AsyncResult.value(result))?.files ?? [];
  const pending = props.pendingInput || result.waiting;
  const error =
    result._tag === "Failure"
      ? googleErrorMessage(Cause.squash(result.cause), "Could not search Google.")
      : null;
  return (
    <FlatList
      data={files}
      keyExtractor={(page) => page.url}
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
              {error ?? "No matching files."}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.title}
          disabled={props.attaching !== null}
          onPress={() => props.onPick(item)}
          className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              <Text className="text-sm font-t3-semibold text-foreground">{item.title}</Text>
              {` · ${relativeTime(item.updatedAt)}`}
            </Text>
            <Text className="text-base text-foreground" numberOfLines={2}>
              {item.url}
            </Text>
          </View>
          {props.attaching === item.url ? <ActivityIndicator /> : null}
        </Pressable>
      )}
    />
  );
}
