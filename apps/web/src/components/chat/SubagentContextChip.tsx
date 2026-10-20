import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { edgeAgentStatus } from "@t3tools/client-runtime/state/agent-fleet";
import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { useThreadShell } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";

import { StatusDot } from "../AgentStatus";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import type { SubagentChipRecord } from "../contextPreviews";
import { showAgentInPanel } from "./agentContextMenu";

/**
 * Fork: inline chip for a referenced subagent, in the composer and in sent messages. Shows the
 * handle it was referenced by and the agent's status now; clicking opens it in the Agents panel.
 * Its hover is the subagent preview from the context presentation registry.
 */
export function SubagentChipTrigger({
  record,
  copyMarkdown,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render" | "children"> & {
  record: SubagentChipRecord;
  copyMarkdown?: string | undefined;
}) {
  const ownerRef = scopeThreadRef(record.environmentId, record.ownerThreadId);
  const childShell = useThreadShell(
    record.childThreadId === null
      ? null
      : scopeThreadRef(record.environmentId, record.childThreadId),
  );
  // The record's status while the owner is loaded, else the one captured with the chip; a live
  // follow-up run on the child thread wins, as in the Agents panel.
  const recordStatus = useAtomValue(
    environmentThreadDetails.threadAtom(ownerRef),
    (thread) =>
      thread?.projection.subagents.find((agent) =>
        record.subagentId === null
          ? agent.childThreadId === record.childThreadId
          : agent.id === record.subagentId,
      )?.status ?? null,
  );
  const liveRunStatus = childShell?.source.activityRunStatus ?? null;
  const status = edgeAgentStatus(
    liveRunStatus === "running" || liveRunStatus === "waiting"
      ? liveRunStatus
      : (recordStatus ?? record.status),
  );
  const key = record.childThreadId ?? `subagent:${record.subagentId}`;
  return (
    <ContextChip
      kind="subagent"
      render={<button type="button" />}
      aria-label={subagentChipAccessibleLabel(record)}
      data-markdown-copy={copyMarkdown}
      onClick={() => showAgentInPanel(ownerRef, key)}
      {...props}
    >
      <StatusDot status={status} />
      <ContextChipLabel>@{record.handle}</ContextChipLabel>
    </ContextChip>
  );
}

export function subagentChipAccessibleLabel(
  record: Pick<SubagentChipRecord, "handle" | "title">,
): string {
  return `Agent @${record.handle}, ${record.title}. Show in Agents panel`;
}
