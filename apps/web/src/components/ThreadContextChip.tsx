import type { ThreadContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import { useProject, useThreadShell } from "~/state/entities";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { ThreadHoverCardPopup, ThreadPreviewHoverCard } from "./ThreadHoverCard";
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
          <ThreadPreviewHoverCard shell={shell} project={project} title={title} />
        </ThreadHoverCardPopup>
      ) : (
        <TooltipPopup side="top">Thread no longer available</TooltipPopup>
      )}
    </Tooltip>
  );
}
