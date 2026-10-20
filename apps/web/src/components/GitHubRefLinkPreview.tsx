import type { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import type { EnvironmentId } from "@t3tools/contracts";
import { useRef, useState, type ReactElement } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { useEnvironmentQuery } from "~/state/query";

import { useCursorAnchor } from "./chat/CursorPreviewCard";
import { GitHubRefIcon, gitHubRefTypeLabel } from "./gitHubRefPresentation";
import { RelativeTime } from "./RelativeTime";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * A GitHub release, tag, branch, or commit link in a message. Hovering it reads the ref once and
 * shows what it names; a link that turns out not to be a ref (a `tree` link to a folder) shows
 * its URL instead.
 */
export function GitHubRefLinkPreview({
  link,
  url,
  environmentId,
}: {
  link: ReactElement;
  url: string;
  environmentId: EnvironmentId;
}) {
  const [open, setOpen] = useState(false);
  const cursorAnchor = useCursorAnchor();
  const previewActionsRef = useRef<PreviewCardPrimitive.Root.Actions | null>(null);
  const openLink = useLinkClickHandler(null);
  const query = useEnvironmentQuery(
    open ? githubIssueEnvironment.ref({ environmentId, input: { url } }) : null,
  );
  const ref = query.data;
  const showUrlTooltip = open && query.error !== null;

  return (
    <PreviewCard
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) cursorAnchor.pin();
        setOpen(nextOpen);
      }}
      actionsRef={previewActionsRef}
    >
      <Tooltip
        open={showUrlTooltip}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && ref === null) previewActionsRef.current?.close();
        }}
      >
        <PreviewCardTrigger
          render={<TooltipTrigger render={link} />}
          delay={350}
          closeDelay={120}
          {...cursorAnchor.triggerProps}
        />
        <TooltipPopup side="top">{url}</TooltipPopup>
      </Tooltip>
      {ref === null ? null : (
        <PreviewCardPopup {...cursorAnchor.popupProps} className="w-80 max-w-[calc(100vw-2rem)]">
          <div className="min-w-0 p-3">
            <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0">
              <GitHubRefIcon refType={ref.refType} />
              <span className="min-w-0 truncate">{ref.repository}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{gitHubRefTypeLabel(ref.refType)}</span>
              {ref.isPrerelease ? <span className="shrink-0">· Pre-release</span> : null}
              <a
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto shrink-0 pl-2 underline-offset-2 hover:text-foreground hover:underline"
                onClick={(event) => openLink(event, ref.url)}
              >
                Open
              </a>
            </div>
            <p className="mt-1 text-sm font-medium leading-snug text-foreground text-pretty">
              {ref.refType === "commit" ? ref.title : ref.ref}
            </p>
            {ref.refType === "commit" || ref.title === ref.ref ? null : (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{ref.title}</p>
            )}
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {ref.sha === null ? null : (
                <span className="shrink-0 font-mono">{ref.sha.slice(0, 7)}</span>
              )}
              {ref.authorLogin === null ? null : (
                <>
                  {ref.sha === null ? null : <span aria-hidden>·</span>}
                  <span className="min-w-0 truncate">{ref.authorLogin}</span>
                </>
              )}
              {ref.date === null ? null : (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    <RelativeTime timestamp={ref.date} />
                  </span>
                </>
              )}
            </div>
          </div>
        </PreviewCardPopup>
      )}
    </PreviewCard>
  );
}
