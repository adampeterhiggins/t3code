import type { EnvironmentId } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import {
  checkoutAccessForDriver,
  checkoutCandidates,
  checkoutContextRecord,
  checkoutDisplayName,
  checkoutPathKey,
  looksLikeCheckoutPath,
  rankCheckoutCandidates,
} from "@t3tools/shared/checkouts";
import { useMemo, useState, type ReactNode } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEnvironmentServerConfig, useProjects, useThreadShells } from "../state/entities";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { sourceControlEnvironment } from "../state/sourceControl";
import {
  captureComposerDraftInsertion,
  insertComposerDraftContext,
  type ComposerDraftInsertion,
} from "../state/use-composer-drafts";
import { AppText as Text, AppTextInput } from "./ui/AppText";
import { PickerSheet } from "./PickerSheet";

export interface CheckoutPickerTarget {
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  readonly driver: string | null;
}

type OpenedCheckoutPicker = CheckoutPickerTarget & {
  readonly insertion: ComposerDraftInsertion;
};

/** Picks a local checkout to reference in the draft. The owner renders `sheet`. */
export function useCheckoutPicker(target: CheckoutPickerTarget | null): {
  readonly open: () => void;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedCheckoutPicker | null>(null);
  return {
    open: () => {
      if (target)
        setOpened({ ...target, insertion: captureComposerDraftInsertion(target.draftKey) });
    },
    sheet: opened ? <CheckoutPickerSheet {...opened} onClose={() => setOpened(null)} /> : null,
  };
}

function CheckoutPickerSheet(props: OpenedCheckoutPicker & { readonly onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const threads = useThreadShells();
  const config = useEnvironmentServerConfig(props.environmentId);
  const [query, setQuery] = useState("");
  const candidates = useMemo(
    () =>
      checkoutCandidates({
        currentEnvironmentId: props.environmentId,
        projects,
        worktrees: threads.map((thread) => ({
          environmentId: thread.environmentId,
          worktreePath: thread.worktreePath,
        })),
        environmentLabel: (id) =>
          id === props.environmentId
            ? (config?.environment.label ?? "This environment")
            : "Another environment",
      }).filter((candidate) => candidate.selectable),
    [config?.environment.label, projects, props.environmentId, threads],
  );
  const ranked = useMemo(
    () => rankCheckoutCandidates(candidates, looksLikeCheckoutPath(query) ? "" : query, new Map()),
    [candidates, query],
  );
  const pasted = looksLikeCheckoutPath(query) ? checkoutPathKey(query.trim()) : null;
  const paths = useMemo(() => {
    const listed = ranked.slice(0, 20).map((candidate) => candidate.path);
    if (pasted !== null && !listed.includes(pasted)) listed.unshift(pasted);
    return listed;
  }, [pasted, ranked]);
  const settled = useDebouncedValue(paths.join("\n"), 200);
  const inspection = useEnvironmentQuery(
    settled.length === 0
      ? null
      : sourceControlEnvironment.checkouts({
          environmentId: props.environmentId,
          input: { paths: settled.split("\n") },
        }),
  );
  const rows = useMemo(() => {
    const listed = ranked.slice(0, 20);
    if (pasted === null || listed.some((candidate) => checkoutPathKey(candidate.path) === pasted)) {
      return listed;
    }
    return [
      {
        environmentId: props.environmentId,
        environmentLabel: "",
        selectable: true,
        path: pasted,
        name: checkoutDisplayName(pasted),
        kind: "project" as const,
      },
      ...listed,
    ];
  }, [pasted, props.environmentId, ranked]);

  const attach = (path: string, name: string) => {
    const entry = inspection.data?.entries.find(
      (candidate) => checkoutPathKey(candidate.path) === checkoutPathKey(path),
    );
    const record = checkoutContextRecord({
      path: entry?.path ?? path,
      name,
      branch: entry?.branch ?? null,
      headSha: entry?.headSha ?? null,
      changedFiles: entry?.changedFiles ?? 0,
      ahead: entry?.ahead ?? 0,
      access: checkoutAccessForDriver(props.driver),
      environmentId: props.environmentId,
    });
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

  return (
    <PickerSheet title="Attach checkout" onClose={props.onClose}>
      <View className="px-4 pb-3">
        <AppTextInput
          accessibilityLabel="Search checkouts"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder="Search by name or paste a path"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.path}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListEmptyComponent={
          <View className="items-center p-6">
            <Text className="text-center text-foreground-muted">
              {pasted
                ? "Press return to use that path."
                : "No local checkouts yet. Paste a path to use a folder."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const entry = inspection.data?.entries.find(
            (candidate) => checkoutPathKey(candidate.path) === checkoutPathKey(item.path),
          );
          const status =
            entry === undefined
              ? item.path
              : `${entry.branch ?? "detached"} · ${entry.changedFiles === 0 ? "clean" : `${entry.changedFiles} changed`}`;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Attach ${item.name}`}
              onPress={() => attach(item.path, item.name)}
              className="gap-0.5 px-4 py-3 active:bg-subtle"
            >
              <Text className="text-base text-foreground" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {status}
              </Text>
            </Pressable>
          );
        }}
      />
    </PickerSheet>
  );
}
