/**
 * Fork: one agent's row in the Agents panel and in an agent's list of the agents it started.
 *
 * - A row is one line. Working agents add their latest tool call and failed agents their error
 *   as a second line, so a row's height only changes with its status.
 * - Hovering a row previews the agent (prompt, outcome, latest tool calls, usage). Clicking the
 *   row or its preview opens the agent; right-click for the agent menu.
 * - Only a working row on screen (or an open preview) subscribes to its child thread.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AgentFleetEntry, AgentFleetRow } from "@t3tools/client-runtime/state/agent-fleet";
import { deriveSubagentToolCalls } from "@t3tools/client-runtime/state/agent-list-view";
import {
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationV2ThreadShell, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, CornerDownRightIcon, XIcon } from "lucide-react";
import { useMemo, useRef, type MouseEvent, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import { cn } from "~/lib/utils";
import { useThreadProjection, useThreadShells } from "~/state/entities";

import { AgentElapsed, STATUS_VISUALS, StatusDot } from "../AgentStatus";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { AgentUsageFooter, ToolCallList } from "./AgentActivityParts";
import { SubagentActivityLine } from "./SubagentActivityLine";

const PREVIEW_TOOL_CALLS = 5;

/** The agent's record, from the viewed thread or, for a nested agent, the thread that spawned it. */
function useAgentRecord(parentRef: ScopedThreadRef, entry: AgentFleetEntry) {
  const ownerRef =
    entry.subagent === null && entry.childThreadId !== null
      ? scopeThreadRef(parentRef.environmentId, entry.ownerThreadId)
      : null;
  const owner = useThreadProjection(ownerRef)?.projection ?? null;
  return (
    entry.subagent ??
    owner?.subagents.find((candidate) => candidate.childThreadId === entry.childThreadId) ??
    null
  );
}

function PreviewSection(props: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h4 className="px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {props.title}
      </h4>
      {props.children}
    </section>
  );
}

/** The hover preview: identity, prompt, outcome, latest tool calls, usage. Mounted while open. */
function AgentPreviewContent(props: {
  parentRef: ScopedThreadRef;
  entry: AgentFleetEntry;
  workspaceRoot: string | null;
  onOpen: () => void;
}) {
  const { entry } = props;
  const record = useAgentRecord(props.parentRef, entry);
  // A nested agent's record arrives with its owner; until then the shell's view stands in.
  const agent: RuntimeSubagent = useMemo(
    () =>
      entry.subagent === null && record !== null
        ? { ...projectedSubagentsToRuntime([record])[0]!, status: entry.agent.status }
        : entry.agent,
    [entry.agent, entry.subagent, record],
  );
  const childRef =
    entry.childThreadId === null
      ? null
      : scopeThreadRef(props.parentRef.environmentId, entry.childThreadId);
  const child = useThreadProjection(childRef)?.projection ?? null;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const calls = useMemo(
    () =>
      child && entry.childThreadId !== null
        ? deriveSubagentToolCalls(
            child.turnItems.filter((item) => item.threadId === entry.childThreadId),
            props.workspaceRoot,
          )
        : [],
    [child, entry.childThreadId, props.workspaceRoot],
  );
  const latest = useMemo(() => calls.slice(-PREVIEW_TOOL_CALLS).toReversed(), [calls]);
  const live = isActiveSubagentStatus(agent.status);
  const totalCalls = Math.max(calls.length, agent.usage?.toolUses ?? 0);
  const outcome = agent.error ?? (live ? null : agent.result);
  const prompt = record?.prompt.trim() || null;
  const identity = [STATUS_VISUALS[agent.status].label, agent.model].filter(
    (value): value is string => value !== null,
  );
  return (
    <div className="flex cursor-pointer flex-col" onClick={props.onOpen}>
      <div className="flex flex-col gap-0.5 border-b border-border/60 px-3 pt-2.5 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={agent.status} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            <AgentElapsed agent={agent} />
          </span>
        </div>
        <p className="truncate ps-3.5 font-mono text-2xs text-muted-foreground">
          {identity.join(" · ")}
        </p>
      </div>
      <div className="flex flex-col gap-2.5 px-2.5 py-2">
        {live && agent.progress ? (
          <PreviewSection title="Now">
            <p className="px-0.5 text-xs text-muted-foreground">{agent.progress}</p>
          </PreviewSection>
        ) : null}
        {prompt ? (
          <PreviewSection title="Prompt">
            <p className="line-clamp-3 whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed text-foreground/85">
              {prompt}
            </p>
          </PreviewSection>
        ) : null}
        {outcome ? (
          <PreviewSection title={agent.error ? "Error" : "Result"}>
            <p
              className={cn(
                "line-clamp-3 whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed",
                agent.error ? "text-destructive-foreground" : "text-foreground/85",
              )}
            >
              {outcome}
            </p>
          </PreviewSection>
        ) : null}
        {latest.length > 0 && entry.childThreadId !== null ? (
          <PreviewSection
            title={
              <>
                Latest tool calls
                <span className="font-mono tracking-normal"> · {totalCalls}</span>
              </>
            }
          >
            {/* Hovering or expanding a call stays in the preview. */}
            <div onClick={(event) => event.stopPropagation()}>
              <ToolCallList
                calls={latest}
                timestampFormat={timestampFormat}
                source={{
                  environmentId: props.parentRef.environmentId,
                  threadId: entry.childThreadId,
                  workspaceRoot: props.workspaceRoot,
                }}
              />
            </div>
            {totalCalls > latest.length ? (
              <p className="ps-6.5 pt-1 text-2xs text-muted-foreground">
                {totalCalls - latest.length} more · click to open the agent
              </p>
            ) : null}
          </PreviewSection>
        ) : null}
      </div>
      <AgentUsageFooter usage={agent.usage} />
    </div>
  );
}

export function AgentRow(props: {
  parentRef: ScopedThreadRef;
  row: AgentFleetRow;
  workspaceRoot: string | null;
  onOpen: (entry: AgentFleetEntry) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, entry: AgentFleetEntry) => void;
}) {
  const { row } = props;
  const { entry } = row;
  const { agent } = entry;
  const previewActions = useRef<{ close: () => void; unmount: () => void } | null>(null);
  const live = isActiveSubagentStatus(agent.status);
  const failed = agent.status === "failed";
  const openable = entry.childThreadId !== null;
  const open = () => {
    if (openable) props.onOpen(entry);
  };
  // One truncated line; the full error stays in the preview and the agent tab.
  const error =
    failed && agent.error
      ? agent.error.length > 160
        ? `${agent.error.slice(0, 159)}…`
        : agent.error
      : null;
  return (
    <PreviewCard actionsRef={previewActions}>
      <PreviewCardTrigger
        delay={400}
        closeDelay={150}
        render={
          <button
            type="button"
            onClick={open}
            aria-disabled={!openable}
            onContextMenu={
              openable
                ? (event) => {
                    previewActions.current?.close();
                    props.onContextMenu(event, entry);
                  }
                : undefined
            }
            aria-label={`${entry.title}, ${STATUS_VISUALS[agent.status].label}. Show details`}
            className={cn(
              "flex w-full flex-col rounded-md px-1.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
              row.context && "opacity-60",
            )}
            style={row.depth > 0 ? { paddingInlineStart: `${row.depth * 0.875 + 0.375}rem` } : {}}
          />
        }
      >
        <span className="flex h-6 items-center gap-2">
          {row.depth > 0 ? (
            <CornerDownRightIcon aria-hidden className="-me-1 size-3 shrink-0 text-icon-muted" />
          ) : null}
          <StatusDot status={agent.status} />
          <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
          {agent.status === "completed" ? (
            <CheckIcon aria-hidden className="size-3 shrink-0 text-success" />
          ) : failed ? (
            <XIcon aria-hidden className="size-3 shrink-0 text-destructive" />
          ) : null}
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/80">
            {agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : ""}
          </span>
          <span className="min-w-12 shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
            <AgentElapsed agent={agent} />
          </span>
        </span>
        {live && entry.childThreadId !== null ? (
          <span className="flex h-5 min-w-0 items-center ps-3.5">
            <SubagentActivityLine
              childRef={scopeThreadRef(props.parentRef.environmentId, entry.childThreadId)}
              progress={agent.progress}
              workspaceRoot={props.workspaceRoot}
            />
          </span>
        ) : error ? (
          <span className="flex h-5 min-w-0 items-center ps-3.5">
            <span className="min-w-0 truncate font-mono text-2xs text-destructive-foreground">
              {error}
            </span>
          </span>
        ) : null}
      </PreviewCardTrigger>
      <PreviewCardPopup side="left" align="start" className="w-100 max-w-[calc(100vw-2rem)]">
        <AgentPreviewContent
          parentRef={props.parentRef}
          entry={entry}
          workspaceRoot={props.workspaceRoot}
          onOpen={open}
        />
      </PreviewCardPopup>
    </PreviewCard>
  );
}
/** Live and archived shells of one environment, live copies first. */
export function useEnvironmentShells(environmentId: ScopedThreadRef["environmentId"]) {
  const threadShells = useThreadShells();
  const archived = useArchivedThreadSnapshots([environmentId]);
  const archivedShells = archived.snapshots.find((entry) => entry.environmentId === environmentId)
    ?.snapshot.threads;
  return useMemo(
    (): ReadonlyArray<OrchestrationV2ThreadShell> => [
      ...threadShells
        .filter((thread) => thread.environmentId === environmentId)
        .map((thread) => thread.source),
      ...(archivedShells ?? []),
    ],
    [archivedShells, environmentId, threadShells],
  );
}
