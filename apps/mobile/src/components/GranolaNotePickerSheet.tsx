import type { EnvironmentId, GranolaNoteSummary, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { granolaNoteContextRecord } from "@t3tools/client-runtime/state/granola";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEnvironmentServerConfig } from "../state/entities";
import { granolaEnvironment } from "../state/granola";
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

/** The server filters a cached list of recent meetings, so typing can settle quickly. */
const SEARCH_DEBOUNCE_MS = 250;

const MEETING_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A note's meeting date and participants, as the secondary line under its title. */
export function granolaNoteDetail(note: {
  readonly meetingAt: string | null;
  /** Names from a note summary, or the joined names an attached record keeps. */
  readonly participants: string | ReadonlyArray<string>;
}): string {
  const meetingAt = note.meetingAt ? new Date(note.meetingAt) : null;
  return [
    meetingAt && !Number.isNaN(meetingAt.getTime())
      ? MEETING_DATE_FORMATTER.format(meetingAt)
      : null,
    (typeof note.participants === "string"
      ? note.participants
      : note.participants.join(", ")
    ).trim() || null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** Granola's failures carry a reason; a rate limit deserves a clearer hint than its detail. */
function granolaErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    if (error.reason === "rate-limited") return "Granola is busy. Try again shortly.";
    if (error.reason === "not-connected" || error.reason === "revoked") {
      return "Granola is not connected. Connect it from Settings > Integrations on desktop or web.";
    }
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** Attach inserts the note into a composer draft; link links it to the thread's tab group. */
export type GranolaNotePickerTarget =
  | { readonly mode?: "attach"; readonly environmentId: EnvironmentId; readonly draftKey: string }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

type OpenedGranolaNotePicker =
  | {
      readonly mode: "attach";
      readonly environmentId: EnvironmentId;
      readonly draftKey: string;
      readonly insertion: ComposerDraftInsertion;
    }
  | { readonly mode: "link"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * A Granola note picker. The owner renders `sheet` somewhere that outlives composer focus:
 * opening the sheet blurs the editor, which can unmount a focus-dependent toolbar.
 */
export function useGranolaNotePicker(target: GranolaNotePickerTarget | null): {
  readonly open: (() => void) | undefined;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedGranolaNotePicker | null>(null);
  const serverConfig = useEnvironmentServerConfig(target?.environmentId ?? null);
  const enabled = serverConfig?.settings.enableGranolaIntegration === true;
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
      opened && openedServerConfig?.settings.enableGranolaIntegration ? (
        <GranolaNotePickerSheet {...opened} onClose={() => setOpened(null)} />
      ) : null,
  };
}

/**
 * Attaches a Granola note at the caret the composer had when the sheet opened, or links it to the
 * thread's tab group. Mobile has no Granola settings, so an unconnected environment points at
 * desktop or web.
 */
function GranolaNotePickerSheet(props: OpenedGranolaNotePicker & { readonly onClose: () => void }) {
  const connection = useEnvironmentQuery(
    granolaEnvironment.connection({ environmentId: props.environmentId, input: {} }),
  );
  const phase = connection.data?.phase;
  return (
    <PickerSheet
      title={props.mode === "link" ? "Link Granola note" : "Granola note"}
      onClose={props.onClose}
    >
      {phase === "connected" ? (
        <GranolaNoteSearch {...props} />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {phase === undefined && !connection.error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-center text-foreground-muted">
              {connection.error ??
                "Granola is not connected on this environment. Connect it from Settings > Integrations on desktop or web."}
            </Text>
          )}
        </View>
      )}
    </PickerSheet>
  );
}

function GranolaNoteSearch(props: OpenedGranolaNotePicker & { readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const getNote = useAtomCommand(granolaEnvironment.getNote, {
    label: "granola note fetch",
    reportFailure: false,
  });
  const linkThread = useAtomCommand(granolaEnvironment.linkThread, {
    label: "granola thread link",
    reportFailure: false,
  });
  const [attaching, setAttaching] = useState<string | null>(null);

  const link = async (threadId: ThreadId, note: GranolaNoteSummary) => {
    const result = await linkThread({
      environmentId: props.environmentId,
      input: { threadId, noteId: note.id },
    });
    if (result._tag === "Failure") {
      Alert.alert(
        "Could not link Granola note",
        granolaErrorMessage(squashAtomCommandFailure(result), "Try again."),
      );
      return;
    }
    props.onClose();
  };

  const attach = async (note: GranolaNoteSummary) => {
    if (attaching) return;
    setAttaching(note.id);
    try {
      if (props.mode === "link") {
        await link(props.threadId, note);
        return;
      }
      const fetched = await getNote({
        environmentId: props.environmentId,
        input: { id: note.id },
      });
      if (fetched._tag === "Failure") {
        Alert.alert(
          "Could not attach Granola note",
          granolaErrorMessage(squashAtomCommandFailure(fetched), "Try again."),
        );
        return;
      }
      const record = granolaNoteContextRecord(fetched.value);
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
          accessibilityLabel="Search Granola notes"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search meetings or paste a Granola link"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <GranolaNoteResults
        environmentId={props.environmentId}
        query={settled}
        pendingInput={settled !== trimmed}
        attaching={attaching}
        onPick={(note) => void attach(note)}
      />
    </View>
  );
}

/** An empty query lists the last 30 days of meetings; text filters them by title or people. */
function GranolaNoteResults(props: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly pendingInput: boolean;
  readonly attaching: string | null;
  readonly onPick: (note: GranolaNoteSummary) => void;
}) {
  const insets = useSafeAreaInsets();
  const result = useAtomValue(
    granolaEnvironment.notes({
      environmentId: props.environmentId,
      input: { query: props.query },
    }),
  );
  const notes = Option.getOrNull(AsyncResult.value(result))?.notes ?? [];
  const pending = props.pendingInput || result.waiting;
  const error =
    result._tag === "Failure"
      ? granolaErrorMessage(Cause.squash(result.cause), "Could not search Granola.")
      : null;
  return (
    <FlatList
      data={notes}
      keyExtractor={(note) => note.id}
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
              {error ??
                (props.query ? "No matching meetings." : "No meetings in the last 30 days.")}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const detail = granolaNoteDetail(item);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            disabled={props.attaching !== null}
            onPress={() => props.onPick(item)}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-60"
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-base font-t3-semibold text-foreground" numberOfLines={2}>
                {item.title}
              </Text>
              {detail ? (
                <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                  {detail}
                </Text>
              ) : null}
            </View>
            {props.attaching === item.id ? <ActivityIndicator /> : null}
          </Pressable>
        );
      }}
    />
  );
}
