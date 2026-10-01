import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";

import { useThreadShell } from "../../state/entities";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The chat header's chip for a thread an agent started. It names the thread
 * whose agent started this one and opens it, or names the agent access token
 * when an agent outside T3 Code did.
 */
export function StartedByChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const createdBy = useThreadShell(threadRef)?.createdBy ?? null;
  const parentRef =
    createdBy?.kind === "thread"
      ? scopeThreadRef(threadRef.environmentId, createdBy.threadId)
      : null;
  const parent = useThreadShell(parentRef);
  const navigate = useNavigate();
  if (createdBy === null) return null;

  const label =
    createdBy.kind === "agent-access" ? createdBy.label : (parent?.title ?? "an archived thread");
  const description = `Started by ${createdBy.kind === "agent-access" ? "the agent using" : "the agent in"} ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={description}
            onClick={() => {
              if (parentRef === null || parent === null) return;
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId: parentRef.environmentId, threadId: parentRef.threadId },
              });
            }}
          />
        }
      >
        <BotIcon />
        <span className="max-w-40 truncate">{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{description}</TooltipPopup>
    </Tooltip>
  );
}
