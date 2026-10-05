import { latestSubagentToolCall } from "@t3tools/client-runtime/state/agent-list-view";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadProjection } from "../../state/entities";
import { TOOL_KIND_ICONS } from "./agentToolKinds";

/**
 * Fork: a working agent's second line in Lineage and the Agents panel, its latest tool call read
 * from its child thread, or the provider's progress until the first call arrives. Subscribes to
 * the child thread, so mount it only for working rows on screen.
 */
export function SubagentActivityLine(props: {
  readonly childRef: ScopedThreadRef;
  readonly progress: string | null;
  readonly workspaceRoot: string | null;
}) {
  const child = useThreadProjection(props.childRef)?.projection ?? null;
  const latest = useMemo(
    () =>
      child === null
        ? null
        : latestSubagentToolCall(
            child.turnItems.filter((item) => item.threadId === props.childRef.threadId),
            props.workspaceRoot,
          ),
    [child, props.childRef.threadId, props.workspaceRoot],
  );
  if (latest === null) {
    return (
      <span className="block truncate text-left text-2xs font-normal text-muted-foreground">
        {props.progress ?? "Starting…"}
      </span>
    );
  }
  const Icon = TOOL_KIND_ICONS[latest.kind];
  return (
    <span className="flex min-w-0 items-center gap-1 text-left text-2xs font-normal text-muted-foreground">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className={latest.detail ? "max-w-[45%] shrink-0 truncate" : "min-w-0 truncate"}>
        {latest.title}
      </span>
      {latest.detail ? <span className="min-w-0 truncate font-mono">{latest.detail}</span> : null}
    </span>
  );
}
