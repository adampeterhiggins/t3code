import type { LegendListRef } from "@legendapp/list/react";
import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { toastManager } from "../ui/toast";
import type { AssistantCitationTarget } from "./AssistantCitationSource";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { citationRowIndex } from "./transcriptCitation.logic";

const REVEAL_HIGHLIGHT_MS = 2_400;
// Keeps the first cited row clear of the timeline's top fade.
const REVEAL_VIEW_OFFSET = 96;

/**
 * Scrolls a transcript excerpt's first visible item into view and returns the items to tint
 * for a moment. Quotes from one response are revealed by `AssistantCitationSource` instead.
 */
export function useTranscriptCitationReveal({
  target,
  rows,
  listRef,
}: {
  target: AssistantCitationTarget | null;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
}): ReadonlyArray<string> {
  const [fadedKey, setFadedKey] = useState<string | null>(null);
  const reveal = useEffectEvent((request: AssistantCitationTarget) => {
    const list = listRef.current;
    const activation = request.activationRef.current;
    const index = citationRowIndex(rows, request.citation);
    if (!list || index < 0 || activation.dismissed || activation.scrolled) return;
    activation.scrolled = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void list
      .scrollToIndex({ index, animated: !reducedMotion, viewOffset: REVEAL_VIEW_OFFSET })
      .then(request.onComplete, () => {
        request.onComplete();
        toastManager.add({
          type: "warning",
          title: "Could not open the cited excerpt",
          description: "Click the citation to try again.",
        });
      });
  });

  useEffect(() => {
    if (!target?.citation.segments) return;
    reveal(target);
    const timer = window.setTimeout(() => setFadedKey(target.key), REVEAL_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [target]);

  if (!target?.citation.segments || fadedKey === target.key) return [];
  return target.citation.segments.map((segment) => segment.id);
}
