import {
  TurnItemId,
  type ModelSelection,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type ProviderThreadId,
  type RunId,
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

/** A timeline divider for a model switch. Null when the model did not change. */
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
  if (input.from === null || input.to === null || !modelIdentitiesDiffer(input.from, input.to)) {
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
    title: "Model changed",
    startedAt: input.now,
    completedAt: input.now,
    updatedAt: input.now,
    type: "model_change",
    from: input.from,
    to: input.to,
  };
}

/**
 * The divider shown before the next message, once the composer model differs
 * from the model the thread is already on.
 */
export function pendingModelChangeProjection(input: {
  readonly threadId: ThreadId;
  readonly draft: ModelSelection | null;
  readonly runs: ReadonlyArray<ModelChangeRun>;
  readonly now: DateTime.Utc;
}): OrchestrationV2ProjectedTurnItem | null {
  const item = modelChangeTurnItem({
    id: TurnItemId.make(`turn-item:model-change:pending:${input.threadId}`),
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    ordinal: Number.MAX_SAFE_INTEGER,
    from: modelChangeSourceSelection(input.runs),
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
