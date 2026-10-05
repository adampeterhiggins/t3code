import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { resolveStartedBy, startedByThreadRef } from "@t3tools/client-runtime/state/startedBy";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";

import { useThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The chat header's chip for a thread an agent started. It names the thread
 * whose agent started this one and opens it, or names the agent access token
 * when an agent outside T3 Code did.
 */
export function StartedByChip(props: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(props.threadRef);
  const starter = useThreadShell(startedByThreadRef(thread));
  const navigate = useNavigate();
  const attribution = resolveStartedBy(thread, starter);
  if (attribution === null) return null;
  const { label, description, openRef } = attribution;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={description}
            onClick={() => {
              if (openRef === null) return;
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(openRef),
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

/**
 * The sidebar hover card's line naming who started the thread. It mounts only
 * while the card is open, so rows pay for the starter lookup on hover alone.
 */
export function StartedByHoverLine(props: {
  thread: Pick<EnvironmentThreadShell, "environmentId" | "startedBy">;
}) {
  const starter = useThreadShell(startedByThreadRef(props.thread));
  const attribution = resolveStartedBy(props.thread, starter);
  if (attribution === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <BotIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />
      <div className="min-w-0 truncate text-foreground/75">{attribution.description}</div>
    </div>
  );
}
