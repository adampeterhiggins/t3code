import type {
  ModelContextOption,
  ModelContextRecord,
  ProviderInstanceId,
  ProviderOptionSelection,
  ScopedThreadRef,
  ServerProviderModel,
} from "@t3tools/contracts";
import { modelContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import { randomUUID } from "~/lib/utils";
import type { ProviderInstanceEntry } from "~/providerInstances";

/**
 * Fork: the chip's options from the trait selections, labelled with the model's descriptors as
 * they read now, so the chip keeps what the user saw even if the provider renames them later.
 */
export function modelContextOptions(
  model: ServerProviderModel | null,
  selections: ReadonlyArray<ProviderOptionSelection>,
): ModelContextOption[] {
  const descriptors = model?.capabilities?.optionDescriptors ?? [];
  const options: ModelContextOption[] = [];
  for (const selection of selections) {
    const descriptor = descriptors.find((candidate) => candidate.id === selection.id);
    if (!descriptor) continue;
    if (descriptor.type === "boolean") {
      if (typeof selection.value !== "boolean") continue;
      options.push({
        id: selection.id,
        value: selection.value,
        label: descriptor.label,
        valueLabel: selection.value ? "On" : "Off",
      });
      continue;
    }
    const choice = descriptor.options.find((candidate) => candidate.id === selection.value);
    if (!choice) continue;
    options.push({
      id: selection.id,
      value: choice.id,
      label: descriptor.label,
      valueLabel: choice.label,
    });
  }
  return options;
}

/** Puts a chip for `model` at the caret of `composerRef`'s composer, or at the end of its draft. */
export function attachModelToChat(
  composerRef: ScopedThreadRef,
  input: {
    entry: ProviderInstanceEntry;
    slug: string;
    name: string;
    selections?: ReadonlyArray<ProviderOptionSelection>;
  },
): ModelContextRecord {
  const model = input.entry.models.find((candidate) => candidate.slug === input.slug) ?? null;
  return insertModelChip(composerRef, {
    providerInstanceId: input.entry.instanceId,
    driver: input.entry.driverKind,
    instanceName: input.entry.displayName,
    model: input.slug,
    modelName: input.name,
    options: modelContextOptions(model, input.selections ?? []),
  });
}

/**
 * Puts a chip for a model chosen before the draft existed, such as in the quick message panel.
 * Traits are left unset; the draft's chip can still be edited after it lands.
 */
export function attachStoredModelToChat(
  composerRef: ScopedThreadRef,
  input: {
    providerInstanceId: ProviderInstanceId;
    driver: string;
    instanceName: string;
    model: string;
    modelName: string;
  },
): ModelContextRecord {
  return insertModelChip(composerRef, { ...input, options: [] });
}

function insertModelChip(
  composerRef: ScopedThreadRef,
  input: {
    providerInstanceId: ProviderInstanceId;
    driver: string;
    instanceName: string;
    model: string;
    modelName: string;
    options: ReadonlyArray<ModelContextOption>;
  },
): ModelContextRecord {
  const record = modelContextRecord({
    // Each chip gets its own record, so editing one chip's traits leaves the others alone.
    chipId: randomUUID(),
    ...input,
    writtenAt: new Date().toISOString(),
  });
  useIssueContextStore.getState().upsert(composerRef.threadId, record);
  useComposerDraftStore.getState().insertContextReference(composerRef, {
    kind: "model",
    contextId: record.contextId,
    label: record.label,
  });
  return record;
}
