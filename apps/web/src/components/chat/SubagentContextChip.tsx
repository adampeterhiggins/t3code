import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadAgentFleet, edgeAgentStatus } from "@t3tools/client-runtime/state/agent-fleet";
import type { SubagentContextRecord } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { useProject, useThreadProjection, useThreadShell } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";

import { StatusDot } from "../AgentStatus";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { showAgentInPanel } from "./agentContextMenu";
import { AgentPreviewContent, useEnvironmentShells, useProviderEntries } from "./AgentFleetRow";

type SubagentChipRecord = Pick<
  SubagentContextRecord,
  "environmentId" | "ownerThreadId" | "childThreadId" | "subagentId" | "handle" | "title" | "status"
>;

/**
 * Fork: inline chip for a referenced subagent, in the composer and in sent messages. Shows the
 * handle it was referenced by and the agent's status now; hovering previews the agent and
 * clicking opens it in the Agents panel.
 */
export function SubagentContextChip(props: { record: SubagentChipRecord; copyMarkdown?: string }) {
  const { record } = props;
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
    <PreviewCard>
      <PreviewCardTrigger
        delay={400}
        closeDelay={150}
        render={
          <ContextChip
            kind="subagent"
            render={<button type="button" />}
            aria-label={`Agent @${record.handle}, ${record.title}. Show in Agents panel`}
            data-markdown-copy={props.copyMarkdown}
            onClick={() => showAgentInPanel(ownerRef, key)}
          />
        }
      >
        <StatusDot status={status} />
        <ContextChipLabel>@{record.handle}</ContextChipLabel>
      </PreviewCardTrigger>
      <PreviewCardPopup side="top" align="start" className="w-100 max-w-[calc(100vw-2rem)]">
        <SubagentChipPreview record={record} />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/** The agent's Agents panel preview, found among its owner's agents. Mounted while open. */
function SubagentChipPreview(props: { record: SubagentChipRecord }) {
  const { record } = props;
  const ownerRef = scopeThreadRef(record.environmentId, record.ownerThreadId);
  const owner = useThreadProjection(ownerRef)?.projection ?? null;
  const shells = useEnvironmentShells(record.environmentId);
  const providers = useProviderEntries(record.environmentId);
  const project = useProject(
    owner ? scopeProjectRef(record.environmentId, owner.thread.projectId) : null,
  );
  const key = record.childThreadId ?? `subagent:${record.subagentId}`;
  const entry = useMemo(
    () =>
      deriveThreadAgentFleet({
        threadId: record.ownerThreadId,
        subagents: owner?.subagents ?? [],
        shells,
      }).find((candidate) => candidate.key === key) ?? null,
    [key, owner?.subagents, record.ownerThreadId, shells],
  );
  if (entry === null) {
    return (
      <p className="px-3 py-2.5 text-xs text-muted-foreground">
        {owner === null ? "Loading agent…" : `@${record.handle} is no longer recorded.`}
      </p>
    );
  }
  return (
    <AgentPreviewContent
      parentRef={ownerRef}
      entry={entry}
      provider={providers.get(entry.providerInstanceId)}
      workspaceRoot={owner?.thread.worktreePath ?? project?.workspaceRoot ?? null}
      onOpen={() => showAgentInPanel(ownerRef, entry.key)}
    />
  );
}
