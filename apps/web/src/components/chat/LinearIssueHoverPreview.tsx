import type { EnvironmentId } from "@t3tools/contracts";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";

import { useLinearLinkClickHandler } from "~/browser/useLinearLinkClickHandler";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { LinearIssueMarkdown } from "../contextChipParts";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";

interface Point {
  readonly x: number;
  readonly y: number;
}

const keepAnchorDefault = () => {};

// Clear of the cursor so the card never sits under it, but close enough to move into.
const CURSOR_OFFSET_PX = 14;

/**
 * Hover card for a Linear issue row: the snapshot an attached chip would carry. It opens where
 * the cursor rested and stays put. It closes when the pointer leaves the row and card, on any key,
 * or when the list scrolls, but not while scrolling the card itself. The issue is fetched only
 * once the card opens, so scanning a list does not fetch every row.
 */
export function LinearIssueHoverPreview(props: {
  environmentId: EnvironmentId;
  issueId: string;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [anchorPoint, setAnchorPoint] = useState<Point | null>(null);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const popupRef = useRef<HTMLDivElement>(null);
  const issue = useEnvironmentQuery(
    open
      ? linearEnvironment.issue({
          environmentId: props.environmentId,
          input: { id: props.issueId },
        })
      : null,
  );
  const anchor = useMemo(
    () =>
      anchorPoint === null
        ? undefined
        : {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: anchorPoint.x, y: anchorPoint.y, width: 0, height: 0 }),
          },
    [anchorPoint],
  );

  useEffect(() => {
    if (!open) return;
    const insideCard = (event: Event) =>
      event.target instanceof Node && popupRef.current?.contains(event.target) === true;
    const close = (event: Event) => {
      if (!insideCard(event)) setOpen(false);
    };
    const options = { capture: true, passive: true } as const;
    window.addEventListener("keydown", close, true);
    window.addEventListener("wheel", close, options);
    window.addEventListener("scroll", close, options);
    return () => {
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("wheel", close, options);
      window.removeEventListener("scroll", close, options);
    };
  }, [open]);

  // Outside a thread there is no in-app browser to target, so the anchor's own default
  // (a new tab, or the system browser on desktop) is the fallback.
  const openLinearLink = useLinearLinkClickHandler(keepAnchorDefault);
  const detail = issue.data;
  return (
    <PreviewCard
      open={open}
      onOpenChange={(next) => {
        if (next) setAnchorPoint(pointerRef.current);
        setOpen(next);
      }}
    >
      <PreviewCardTrigger
        render={props.trigger}
        delay={400}
        closeDelay={150}
        onPointerMove={(event) => {
          pointerRef.current = { x: event.clientX, y: event.clientY };
        }}
      />
      <PreviewCardPopup
        ref={popupRef}
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={CURSOR_OFFSET_PX}
        className="w-96 max-w-[calc(100vw-2rem)]"
      >
        <div className="p-3 text-xs">
          {detail === null ? (
            <p className="text-muted-foreground">{issue.error ?? "Loading issue…"}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
                <span className="min-w-0 truncate">
                  {detail.identifier} · {detail.stateName}
                </span>
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
                  onClick={(event) => openLinearLink(event, detail.url)}
                >
                  Open in Linear
                </a>
              </div>
              <LinearIssueMarkdown markdown={detail.markdown} url={detail.url} />
            </div>
          )}
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
