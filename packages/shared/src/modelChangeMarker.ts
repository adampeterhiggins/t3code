import {
  TurnItemId,
  type ModelSelection,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type ProviderOptionDescriptor,
  type ProviderThreadId,
  type RunId,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { runRanAfter } from "./orchestrationV2ThreadError.ts";

type ModelChangeRun = Pick<
  OrchestrationV2Run,
  "status" | "ordinal" | "startedAt" | "completedAt" | "modelSelection"
>;

/** Instance and model slug. Option-only changes are the same model. */
export function modelIdentitiesDiffer(left: ModelSelection, right: ModelSelection): boolean {
  return left.instanceId !== right.instanceId || left.model !== right.model;
}

export interface ModelOptionChange {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** The option descriptors the provider advertises for a selection's model. */
export function modelOptionDescriptors(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ReadonlyArray<ProviderOptionDescriptor> | undefined {
  return providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((model) => model.slug === selection.model)?.capabilities?.optionDescriptors;
}

/**
 * Option values that differ between two selections of the same model, such as
 * effort, fast mode, or context window. With descriptors, an omitted option
 * resolves to the provider default, so explicitly picking the default is not a
 * change, and options the model does not offer are ignored. Without them the
 * raw values are compared, which is all the server can do.
 */
export function modelOptionChanges(
  from: ModelSelection,
  to: ModelSelection,
  descriptors?: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ModelOptionChange> {
  if (modelIdentitiesDiffer(from, to)) return [];
  const ids =
    descriptors !== undefined
      ? descriptors.map((descriptor) => descriptor.id)
      : [...new Set([...(from.options ?? []), ...(to.options ?? [])].map((option) => option.id))];
  const changes: Array<ModelOptionChange> = [];
  for (const id of ids) {
    const descriptor = descriptors?.find((candidate) => candidate.id === id);
    const fromValue = optionValue(from, id, descriptor);
    const toValue = optionValue(to, id, descriptor);
    if (fromValue === toValue) continue;
    changes.push({
      id,
      label: descriptor?.label ?? id,
      from: optionValueLabel(fromValue, descriptor),
      to: optionValueLabel(toValue, descriptor),
    });
  }
  return changes;
}

/** One line for a divider, e.g. "Effort: Medium → High · Fast: Off → On". */
export function formatModelOptionChanges(changes: ReadonlyArray<ModelOptionChange>): string {
  return changes.map((change) => `${change.label}: ${change.from} → ${change.to}`).join(" · ");
}

function optionValue(
  selection: ModelSelection,
  id: string,
  descriptor: ProviderOptionDescriptor | undefined,
): string | boolean | undefined {
  const explicit = selection.options?.find((option) => option.id === id)?.value;
  if (descriptor === undefined) return explicit;
  if (descriptor.type === "boolean") return explicit ?? descriptor.currentValue ?? false;
  // Prompt-injected values such as "ultrathink" dispatch as the default.
  if (typeof explicit === "string" && !descriptor.promptInjectedValues?.includes(explicit)) {
    return explicit;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

function optionValueLabel(
  value: string | boolean | undefined,
  descriptor: ProviderOptionDescriptor | undefined,
): string {
  if (value === undefined) return "Default";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (descriptor?.type === "select") {
    return descriptor.options.find((option) => option.id === value)?.label ?? value;
  }
  return value;
}

/** True when the selection moved to another model or changed any of its options. */
export function modelSelectionChanged(
  from: ModelSelection,
  to: ModelSelection,
  descriptors?: ReadonlyArray<ProviderOptionDescriptor>,
): boolean {
  return modelIdentitiesDiffer(from, to) || modelOptionChanges(from, to, descriptors).length > 0;
}

/**
 * The model the conversation is on, ignoring a held queue and runs that never
 * started. A queued message has not reached the transcript yet.
 */
export function modelChangeSourceSelection(
  runs: ReadonlyArray<ModelChangeRun>,
): ModelSelection | null {
  let latest: ModelChangeRun | null = null;
  for (const run of runs) {
    if (run.status === "queued" || run.status === "rolled_back") continue;
    if (run.status === "cancelled" && run.startedAt === null) continue;
    if (latest === null || runRanAfter(run, latest)) latest = run;
  }
  return latest?.modelSelection ?? null;
}

/** A timeline divider for a model or option switch. Null when nothing changed. */
export function modelChangeTurnItem(input: {
  readonly id: TurnItemId;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly nodeId: OrchestrationV2TurnItem["nodeId"];
  readonly providerThreadId: ProviderThreadId | null;
  readonly ordinal: number;
  readonly from: ModelSelection | null;
  readonly to: ModelSelection | null;
  readonly now: DateTime.Utc;
}): Extract<OrchestrationV2TurnItem, { type: "model_change" }> | null {
  if (input.from === null || input.to === null || !modelSelectionChanged(input.from, input.to)) {
    return null;
  }
  return {
    id: input.id,
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.nodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "completed",
    title: modelIdentitiesDiffer(input.from, input.to) ? "Model changed" : "Model settings changed",
    startedAt: input.now,
    completedAt: input.now,
    updatedAt: input.now,
    type: "model_change",
    from: input.from,
    to: input.to,
  };
}

/**
 * The divider shown before the next message, once the composer model or its
 * options differ from what the thread is already on.
 */
export function pendingModelChangeProjection(input: {
  readonly threadId: ThreadId;
  readonly draft: ModelSelection | null;
  readonly runs: ReadonlyArray<ModelChangeRun>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly now: DateTime.Utc;
}): OrchestrationV2ProjectedTurnItem | null {
  const from = modelChangeSourceSelection(input.runs);
  if (
    from === null ||
    input.draft === null ||
    !modelSelectionChanged(from, input.draft, modelOptionDescriptors(input.providers, from))
  ) {
    return null;
  }
  const item = modelChangeTurnItem({
    id: TurnItemId.make(`turn-item:model-change:pending:${input.threadId}`),
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    ordinal: Number.MAX_SAFE_INTEGER,
    from,
    to: input.draft,
    now: input.now,
  });
  if (item === null) return null;
  return {
    position: Number.MAX_SAFE_INTEGER,
    visibility: "synthetic",
    sourceThreadId: input.threadId,
    sourceItemId: item.id,
    item,
  };
}
