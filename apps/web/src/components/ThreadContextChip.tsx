import type { ThreadContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { BotIcon, FolderIcon, GitBranchIcon, MessagesSquareIcon } from "lucide-react";

import { useProject, useThreadShell } from "~/state/entities";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { ThreadHoverCard, ThreadHoverCardPopup } from "./ThreadHoverCard";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ThreadContextChip(props: {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  copyMarkdown?: string;
  unreadable?: boolean;
}) {
  const { environmentId, threadId } = props.record;
  const shell = useThreadShell({ environmentId, threadId });
  const project = useProject(shell ? { environmentId, projectId: shell.projectId } : null);
  const title = shell?.title?.trim() || props.record.title;
  const preview = shell?.source.latestVisibleMessage?.text.trim();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="thread"
            {...(props.unreadable ? { state: "invalid" as const } : {})}
            render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
            aria-label={`Thread, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
          >
            <MessagesSquareIcon />
            <ContextChipLabel>{title}</ContextChipLabel>
          </ContextChip>
        }
      />
      {props.unreadable ? (
        <TooltipPopup side="top">
          On another machine, so this machine's agent can't read it. Remove it or switch back to
          send.
        </TooltipPopup>
      ) : shell ? (
        <ThreadHoverCardPopup side="top">
          <ThreadHoverCard title={title}>
            {project ? (
              <div className="flex min-w-0 items-center gap-2">
                <FolderIcon aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{project.title}</span>
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <BotIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{shell.modelSelection.model}</span>
              <span className="ml-auto shrink-0 capitalize">
                {shell.source.status.replaceAll("_", " ")}
              </span>
            </div>
            {shell.branch ? (
              <div className="flex min-w-0 items-center gap-2">
                <GitBranchIcon aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{shell.branch}</span>
              </div>
            ) : null}
            {preview ? (
              <p className="line-clamp-4 border-t border-border/60 pt-2 break-words whitespace-pre-wrap text-foreground/85">
                {preview.slice(0, 600)}
                {preview.length > 600 ? "…" : ""}
              </p>
            ) : (
              <p>No messages yet</p>
            )}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      ) : (
        <TooltipPopup side="top">Thread no longer available</TooltipPopup>
      )}
    </Tooltip>
  );
}
