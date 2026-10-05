import { latestSubagentToolCall } from "@t3tools/client-runtime/state/agent-list-view";
import type { RuntimeSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadProjection } from "../../state/entities";
import { TOOL_KIND_ICONS } from "./agentToolKinds";

/** A waiting agent needs the user; a running call shows a static `…`. */
function StatusMarker(props: { waiting: boolean; running: boolean }) {
  if (props.waiting) {
    return <span className="shrink-0 font-mono text-2xs text-warning-foreground">waiting</span>;
  }
  return props.running ? (
    <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">…</span>
  ) : null;
}

/**
 * Fork: a working agent's second line in Lineage and the Agents panel, its latest tool call read
 * from its child thread, or the provider's progress until the first call arrives. Subscribes to
 * the child thread, so mount it only for working rows on screen. An agent without a child thread
 * shows its progress alone.
 */
export function SubagentActivityLine(props: {
  readonly childRef: ScopedThreadRef | null;
  readonly status: RuntimeSubagentStatus;
  readonly progress: string | null;
  readonly workspaceRoot: string | null;
}) {
  const child = useThreadProjection(props.childRef)?.projection ?? null;
  const childThreadId = props.childRef?.threadId ?? null;
  const latest = useMemo(
    () =>
      child === null
        ? null
        : latestSubagentToolCall(
            child.turnItems.filter((item) => item.threadId === childThreadId),
            props.workspaceRoot,
          ),
    [child, childThreadId, props.workspaceRoot],
  );
  const waiting = props.status === "waiting";
  if (latest === null) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-left text-2xs font-normal text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{props.progress ?? "Starting…"}</span>
        <StatusMarker waiting={waiting} running={false} />
      </span>
    );
  }
  const Icon = TOOL_KIND_ICONS[latest.kind];
  return (
    <span className="flex min-w-0 items-center gap-1 text-left text-2xs font-normal text-muted-foreground">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className={latest.detail ? "max-w-[45%] shrink-0 truncate" : "min-w-0 flex-1 truncate"}>
        {latest.title}
      </span>
      {latest.detail ? (
        <span className="min-w-0 flex-1 truncate font-mono">{latest.detail}</span>
      ) : null}
      <StatusMarker waiting={waiting} running={latest.status === "running"} />
    </span>
  );
}
