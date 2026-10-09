import type { EnvironmentId, NotionPageSummary, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { notionPageContextRecord } from "@t3tools/client-runtime/state/notion";
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
import { notionEnvironment } from "../state/notion";
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

/** Notion allows about 20 searches a minute, so typing settles longer before it queries. */
const SEARCH_DEBOUNCE_MS = 400;

/** Notion's failures carry a reason; a rate limit deserves a clearer hint than its detail. */
function notionErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "Notion is busy. Try again shortly.";
    if (error.reason === "not-connected" || error.reason === "revoked") {
      return "Notion is not connected. Connect it from Settings > Integrations on desktop or web.";
    }
    if (error.reason === "not-found") return "Share that page with the Notion connection.";
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** Attach inserts the page into a composer draft; link links it to the thread's tab group. */
export type NotionPagePickerTarget =
  | { readonly mode?: "attach"; readonly environmentId: EnvironmentId; readonly draftKey: string }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

type OpenedNotionPagePicker =
  | {
      readonly mode: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * A Notion page picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useNotionPagePicker(target: NotionPagePickerTarget | null): {
  readonly open: (() => void) | undefined;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedNotionPagePicker | null>(null);
  const serverConfig = useEnvironmentServerConfig(target?.environmentId ?? null);
  const enabled = serverConfig?.settings.enableNotionIntegration === true;
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
      opened && openedServerConfig?.settings.enableNotionIntegration ? (
        <NotionPagePickerSheet {...opened} onClose={() => setOpened(null)} />
      ) : null,
  };
}

/**
 * Attaches a Notion page at the caret the composer had when the sheet opened, or links it to the
 * thread's tab group. Mobile has no Notion settings, so an unconnected environment points at
 * desktop or web.
 */
function NotionPagePickerSheet(props: OpenedNotionPagePicker & { readonly onClose: () => void }) {
  const connection = useEnvironmentQuery(
    notionEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <PickerSheet
      title={props.mode === "link" ? "Link Notion page" : "Notion page"}
      onClose={props.onClose}
    >
      {phase === "connected" ? (
        <NotionPageSearch {...props} />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {phase === undefined && !connection.error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              {connection.error ??
                "Notion is not connected on this environment. Connect it from Settings > Integrations on desktop or web."}
            </Text>
          )}
        </View>
      )}
    </PickerSheet>
  );
}

function NotionPageSearch(props: OpenedNotionPagePicker & { readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const getPage = useAtomCommand(notionEnvironment.getPage, {
    label: "notion page fetch",
    reportFailure: false,
  });
  const linkThread = useAtomCommand(notionEnvironment.linkThread, {
    label: "notion thread link",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);

  const link = async (threadId: ThreadId, page: NotionPageSummary) => {
    const result = await linkThread({
      environmentId: props.environmentId,
      input: { threadId, pageId: page.id },
    });
    if (result._tag === "Failure") {
      Alert.alert(
        "Could not link Notion page",
        notionErrorMessage(squashAtomCommandFailure(result), "Try again."),
      );
      return;
    }
    props.onClose();
  };

  const attach = async (page: NotionPageSummary) => {
    if (attaching) return;
    setAttaching(page.url);
    try {
      if (props.mode === "link") {
        await link(props.threadId, page);
        return;
      }
      const fetched = await getPage({
        environmentId: props.environmentId,
        input: { id: page.id },
      });
      if (fetched._tag === "Failure") {
        Alert.alert(
          "Could not attach Notion page",
          notionErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
        );
        return;
      }
      const record = notionPageContextRecord(fetched.value);
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
          accessibilityLabel="Search Notion pages"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search Notion"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {settled ? (
        <NotionPageResults
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
              Search by page title or paste a Notion link.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Mounted only for a settled, non-empty query, so an empty box never spends a search. */
function NotionPageResults(props: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly pendingInput: boolean;
  readonly attaching: string | null;
  readonly onPick: (page: NotionPageSummary) => void;
}) {
  const insets = useSafeAreaInsets();
  const result = useAtomValue(
    notionEnvironment.pages({
      environmentId: props.environmentId,
      input: { query: props.query },
    }),
  );
  const pages = Option.getOrNull(AsyncResult.value(result))?.pages ?? [];
  const pending = props.pendingInput || result.waiting;
  const error =
    result._tag === "Failure"
      ? notionErrorMessage(Cause.squash(result.cause), "Could not search Notion.")
      : null;
  return (
    <FlatList
      data={pages}
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
              {error ?? "No matching pages."}
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
