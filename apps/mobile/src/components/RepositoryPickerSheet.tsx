import {
  describeContextRepositoryGitStatus,
  findContextRepositoryClone,
  pastedContextRepositoryEntry,
  rankContextRepositoryCandidates,
  repositoryContextRecord,
  splitContextRepositoryOwnerQuery,
} from "@t3tools/client-runtime/context-repositories";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEnvironmentServerConfig } from "../state/entities";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { sourceControlEnvironment } from "../state/sourceControl";
import {
  captureComposerDraftInsertion,
  insertComposerDraftContext,
  type ComposerDraftInsertion,
} from "../state/use-composer-drafts";
import { AppText as Text, AppTextInput } from "./AppText";
import { PickerSheet } from "./PickerSheet";

const OWNER_DEBOUNCE_MS = 300;
const NO_RECENTS: ReadonlyMap<string, number> = new Map();

export interface RepositoryPickerTarget {
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  /** Where the thread's clones live, once it has a workspace, so rows can say what is there. */
  readonly workspaceCwd: string | null;
}

type OpenedRepositoryPicker = RepositoryPickerTarget & {
  readonly insertion: ComposerDraftInsertion;
};

/**
 * Picks a repository to clone into the workspace's context folder when the message sends. The
 * owner renders `sheet` somewhere that outlives composer focus, like `useLinearIssuePicker`.
 */
export function useRepositoryPicker(target: RepositoryPickerTarget | null): {
  readonly open: () => void;
  readonly sheet: ReactNode;
} {
  const [opened, setOpened] = useState<OpenedRepositoryPicker | null>(null);
  return {
    open: () => {
      if (target)
        setOpened({ ...target, insertion: captureComposerDraftInsertion(target.draftKey) });
    },
    sheet: opened ? <RepositoryPickerSheet {...opened} onClose={() => setOpened(null)} /> : null,
  };
}

function RepositoryPickerSheet(props: OpenedRepositoryPicker & { readonly onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const defaultOwner =
    useEnvironmentServerConfig(props.environmentId)?.settings.contextRepositoryOwner ?? "";
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const { owner, filter } = splitContextRepositoryOwnerQuery(trimmed, defaultOwner);
  const settledOwner = useDebouncedValue(owner, OWNER_DEBOUNCE_MS);
  const list = useEnvironmentQuery(
    settledOwner
      ? sourceControlEnvironment.contextRepositories({
          environmentId: props.environmentId,
          input: { owner: settledOwner },
        })
      : null,
  );
  const clones = useEnvironmentQuery(
    props.workspaceCwd
      ? sourceControlEnvironment.contextRepositoryClones({
          environmentId: props.environmentId,
          input: { cwd: props.workspaceCwd },
        })
      : null,
  ).data;
  const shown = rankContextRepositoryCandidates(list.data?.repositories ?? [], filter, NO_RECENTS);
  const pasted = pastedContextRepositoryEntry(trimmed, shown);
  const rows = [
    ...(pasted ? [{ ...pasted, description: pasted.remoteUrl, isPrivate: null }] : []),
    ...shown.map((candidate) => ({
      nameWithOwner: candidate.nameWithOwner,
      remoteUrl: candidate.url,
      description: candidate.description,
      isPrivate: candidate.isPrivate,
    })),
  ];

  const attach = (input: { nameWithOwner: string; remoteUrl: string }) => {
    const record = repositoryContextRecord(input);
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

  const workspaceNote = (remoteUrl: string) => {
    const clone = clones ? findContextRepositoryClone(clones.clones, remoteUrl) : null;
    if (!clone || !clones) return null;
    return `In ${clones.directory}/${clone.directoryName}${clone.git ? ` · ${describeContextRepositoryGitStatus(clone.git)}` : ""}`;
  };

  const status =
    rows.length > 0
      ? null
      : !owner
        ? "Type an owner followed by a slash, like acme/, or paste a repository URL. A default owner can be set in Settings > General on desktop or web."
        : list.isPending || owner !== settledOwner
          ? null
          : (list.error ?? `No repositories in ${owner} match.`);

  return (
    <PickerSheet title="Attach repository" onClose={props.onClose}>
      <View className="px-4 pb-3">
        <AppTextInput
          accessibilityLabel="Search repositories"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder={
            defaultOwner
              ? `Search ${defaultOwner}, type another-org/, or paste a URL`
              : "Type an owner like acme/, or paste a URL"
          }
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.remoteUrl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListEmptyComponent={
          <View className="items-center p-6">
            {status === null ? (
              <ActivityIndicator />
            ) : (
              <Text className="text-center text-foreground-muted">{status}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const note = workspaceNote(item.remoteUrl);
          const detail = note ?? item.description;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Attach ${item.nameWithOwner}`}
              onPress={() => attach(item)}
              className="gap-0.5 px-4 py-3 active:bg-subtle"
            >
              <Text className="text-base text-foreground" numberOfLines={1}>
                {item.nameWithOwner}
                {item.isPrivate ? <Text className="text-foreground-muted"> · private</Text> : null}
              </Text>
              {detail ? (
                <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                  {detail}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </PickerSheet>
  );
}
