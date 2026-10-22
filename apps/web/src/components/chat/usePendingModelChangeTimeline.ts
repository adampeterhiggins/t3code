import type {
  ThreadStructure,
  ThreadStructureVisibleTurnItem,
} from "@t3tools/client-runtime/state/shell";
import * as DateTime from "effect/DateTime";
import type { ServerProvider } from "@t3tools/contracts";
import { pendingModelChangeProjection } from "@t3tools/shared/modelChangeMarker";
import { useComposerDraftStore, type ComposerThreadTarget } from "../../composerDraftStore";
/**
 * The thread's turn items plus the divider for a model the composer has picked but not sent.
 * Derived in a hook of its own so the compiler memoizes the list: useIncrementalTimelineEntries
 * sets state whenever an input changes identity, and inside ChatView the compiler leaves the
 * divider uncached, so a list rebuilt there every render loops it.
 */
export function usePendingModelChangeTimeline(input: {
  readonly draftTarget: ComposerThreadTarget;
  readonly projection: ThreadStructure | null;
  readonly visibleTurnItems: ReadonlyArray<ThreadStructureVisibleTurnItem>;
  readonly updatedAt: string | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const { draftTarget, projection, visibleTurnItems, providers, updatedAt } = input;
  const draft = useComposerDraftStore((store) => {
    const composerDraft = store.getComposerDraft(draftTarget);
    const instanceId = composerDraft?.activeProvider ?? null;
    if (!composerDraft || instanceId === null) return null;
    return composerDraft.modelSelectionByProvider[instanceId] ?? null;
  });
  const pendingModelChange =
    projection === null
      ? null
      : pendingModelChangeProjection({
          threadId: projection.thread.id,
          draft,
          runs: projection.runs,
          providers,
          now: DateTime.makeUnsafe(updatedAt ?? 0),
        });
  return {
    draft,
    pendingModelChange,
    visibleTurnItems:
      pendingModelChange === null ? visibleTurnItems : [...visibleTurnItems, pendingModelChange],
  };
}
