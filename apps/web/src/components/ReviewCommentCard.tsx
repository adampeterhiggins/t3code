import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { reviewCommentCodeLines, type ReviewCommentContext } from "~/reviewCommentContext";
import { PullRequestActorAvatar } from "./pullRequest/pullRequestPresentation";

/** The host's own name for a link, where it is one we know. */
function hostLinkLabel(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "Open";
  }
  if (hostname === "github.com") return "View on GitHub";
  if (hostname === "gitlab.com") return "View on GitLab";
  if (hostname === "bitbucket.org") return "View on Bitbucket";
  return `View on ${hostname}`;
}

function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { directory: "", name: path }
    : { directory: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/**
 * A review comment laid out the way a code host lays out one in its diff: the file bar, the lines
 * it was written against, each remark under its author, and a footer naming where it came from.
 * Any part the comment does not carry is left out rather than shown empty.
 */
export function ReviewCommentCard(props: {
  comment: ReviewCommentContext;
  displayPath: string;
  /** Renders a remark quoted from the host, which is markdown. */
  renderRemark: (body: string) => ReactNode;
  /** The comment's own text, shown when it carries no host conversation. */
  note: ReactNode;
  threadRef?: ScopedThreadRef | null | undefined;
}) {
  const { comment } = props;
  const onLinkClick = useLinkClickHandler(props.threadRef ?? null);
  const codeLines = reviewCommentCodeLines(comment);
  const remarks = comment.thread?.comments ?? [];
  const url = comment.thread?.url ?? comment.pullRequest?.url;
  const { directory, name } = splitPath(props.displayPath);
  const showRange = codeLines.length === 0 && comment.rangeLabel !== "file";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-border bg-muted/60 px-2.5 py-1.5 font-mono text-xs">
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">{directory}</span>
          {name}
        </span>
        {showRange ? (
          <span className="shrink-0 rounded-full border border-border bg-background px-1.5 font-sans text-2xs text-muted-foreground">
            {comment.rangeLabel}
          </span>
        ) : null}
      </div>
      {codeLines.length > 0 ? (
        <div className="max-h-48 overflow-auto border-b border-border font-mono text-xs leading-5">
          {codeLines.map((line, index) => (
            <div
              // Lines carry no identity of their own, and the list never reorders.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              className={cn(
                "flex min-w-max",
                line.change === "add" && "bg-diff-addition/10",
                line.change === "delete" && "bg-diff-deletion/10",
              )}
            >
              <span
                className={cn(
                  "w-10 shrink-0 pr-2 text-right text-muted-foreground tabular-nums select-none",
                  line.change === "add" && "bg-diff-addition/10",
                  line.change === "delete" && "bg-diff-deletion/10",
                )}
              >
                {line.lineNumber ?? ""}
              </span>
              <span
                aria-hidden
                className={cn(
                  "w-4 shrink-0 text-center select-none",
                  line.change === "add" && "text-diff-addition-foreground",
                  line.change === "delete" && "text-diff-deletion-foreground",
                )}
              >
                {line.change === "add" ? "+" : line.change === "delete" ? "-" : " "}
              </span>
              <span className="pr-3 whitespace-pre">{line.content}</span>
            </div>
          ))}
        </div>
      ) : null}
      {remarks.length > 0 ? (
        remarks.map((remark, index) => (
          <div
            // Remarks are a snapshot in thread order and are never edited in place.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            className={cn("flex gap-2.5 px-3 py-2.5", index > 0 && "border-t border-border")}
          >
            <PullRequestActorAvatar
              actor={{ login: remark.author, name: null, avatarUrl: remark.avatarUrl ?? null }}
              className="mt-px size-5"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-xs font-semibold text-foreground">{remark.author}</div>
              <div className="min-w-0 text-sm">{props.renderRemark(remark.body)}</div>
            </div>
          </div>
        ))
      ) : props.note ? (
        <div className="min-w-0 px-3 py-2.5 text-sm">{props.note}</div>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
        <span className="truncate">{comment.sectionTitle}</span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-foreground hover:underline"
            onClick={(event) => onLinkClick(event, url)}
          >
            {hostLinkLabel(url)}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
