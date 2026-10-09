import { cn } from "~/lib/utils";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { copyAgentHandle } from "./agentReferences";

const HANDLE_CLASS_NAME =
  "min-w-0 max-w-44 shrink truncate rounded-sm bg-muted px-1 font-mono text-2xs leading-4 text-muted-foreground";

/**
 * Fork: an agent's `@handle`, the name its chip and the composer's `@` menu use. `copyable` makes
 * it a button that copies the handle, for headers where the agent is the subject.
 */
export function AgentHandle(props: { handle: string; copyable?: boolean; className?: string }) {
  if (!props.copyable) {
    return <span className={cn(HANDLE_CLASS_NAME, props.className)}>@{props.handle}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              HANDLE_CLASS_NAME,
              "cursor-pointer transition-transform duration-100 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
              props.className,
            )}
            onClick={(event) => {
              event.stopPropagation();
              copyAgentHandle(props.handle);
            }}
          />
        }
      >
        @{props.handle}
      </TooltipTrigger>
      <TooltipPopup>Copy handle</TooltipPopup>
    </Tooltip>
  );
}
