import type {
  ModelSelection,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { selectionNeedsContextHandoff } from "@t3tools/shared/modelChangeMarker";

export type HandoffTimelineRun = Pick<
  OrchestrationV2Run,
  "id" | "ordinal" | "providerInstanceId" | "modelSelection"
>;

export type HandoffEndpoints = ReturnType<typeof resolveHandoffEndpoints>;

export function resolvePendingHandoff(
  projection: OrchestrationV2ThreadProjection | null | undefined,
  selection: ModelSelection | null | undefined,
  providers: ReadonlyArray<ServerProvider>,
): HandoffEndpoints | null {
  // A thread with an empty timeline has nothing to hand off. Any loaded row
  // counts: paging can leave a window of only tool rows.
  if (!projection?.visibleTurnItems.length) return null;
  const from = projection.runs.findLast(
    (run) => run.startedAt !== null && run.status !== "rolled_back",
  )?.modelSelection;
  if (from === undefined || selection == null) return null;
  return selectionNeedsContextHandoff(from, selection, providers)
    ? { from: [from], to: selection }
    : null;
}

/**
 * The pending model-change divider already names this switch, including a
 * handoff. The separate handoff preview would repeat it.
 */
export function pendingHandoffCoveredByModelChange(
  handoff: HandoffEndpoints,
  change: { readonly from: ModelSelection; readonly to: ModelSelection } | null,
): boolean {
  if (change === null || handoff.from.length !== 1) return false;
  const source = handoff.from[0];
  return (
    source !== undefined &&
    source.instanceId === change.from.instanceId &&
    source.model === change.from.model &&
    handoff.to.instanceId === change.to.instanceId &&
    handoff.to.model === change.to.model
  );
}

export function resolveHandoffEndpoints(
  item: Pick<
    Extract<OrchestrationV2TurnItem, { type: "handoff" }>,
    "runId" | "fromModelSelections" | "fromProviderInstanceIds" | "toModel" | "toProviderInstanceId"
  >,
  runs: ReadonlyArray<HandoffTimelineRun>,
) {
  const handoffRun = item.runId === null ? undefined : runs.find((run) => run.id === item.runId);
  const toModel =
    item.toModel ??
    (handoffRun !== undefined && handoffRun.providerInstanceId === item.toProviderInstanceId
      ? handoffRun.modelSelection.model
      : undefined);
  const fromEndpoints: ReadonlyArray<HandoffEndpointRef> =
    item.fromModelSelections !== undefined && item.fromModelSelections.length > 0
      ? item.fromModelSelections
      : item.fromProviderInstanceIds.map((instanceId) =>
          endpointFromSelection(
            instanceId,
            latestRunSelectionBefore(runs, instanceId, handoffRun?.ordinal),
          ),
        );
  const toSelection =
    handoffRun !== undefined &&
    handoffRun.providerInstanceId === item.toProviderInstanceId &&
    handoffRun.modelSelection.model === toModel
      ? handoffRun.modelSelection
      : undefined;
  return {
    from: fromEndpoints,
    to: {
      instanceId: item.toProviderInstanceId,
      model: toModel,
      ...(toSelection?.options === undefined ? {} : { options: toSelection.options }),
    },
  };
}

export type HandoffEndpointRef = {
  readonly instanceId: ProviderInstanceId;
  readonly model?: string | undefined;
  readonly options?: ModelSelection["options"];
};

function endpointFromSelection(
  instanceId: ProviderInstanceId,
  selection: ModelSelection | undefined,
): HandoffEndpointRef {
  if (selection === undefined) return { instanceId };
  return {
    instanceId,
    model: selection.model,
    ...(selection.options === undefined ? {} : { options: selection.options }),
  };
}

function latestRunSelectionBefore(
  runs: ReadonlyArray<HandoffTimelineRun>,
  instanceId: ProviderInstanceId,
  beforeOrdinal: number | undefined,
): ModelSelection | undefined {
  let latest: HandoffTimelineRun | undefined;
  for (const run of runs) {
    if (run.providerInstanceId !== instanceId) continue;
    if (beforeOrdinal !== undefined && run.ordinal >= beforeOrdinal) continue;
    if (latest === undefined || run.ordinal > latest.ordinal) latest = run;
  }
  return latest?.modelSelection;
}
