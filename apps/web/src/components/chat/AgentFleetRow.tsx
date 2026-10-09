/**
 * Fork: one agent's row in the Agents panel and in an agent's list of the agents it started.
 *
 * - A row is one line. Working agents add their latest tool call, finished agents the first line
 *   of their result, and failed agents their error as a second line, so a row's height only
 *   changes with its status.
 * - Hovering a row previews the agent (prompt, outcome, latest tool calls, usage). Clicking the
 *   row or its preview opens the agent; clicking a tool call in the preview opens the agent on
 *   that call. Right-click for the agent menu; Alt-click references the agent in chat by its
 *   `@handle`. An agent recorded before its child thread exists
 *   opens too, with its record alone.
 * - Only a working row on screen (or an open preview) subscribes to its child thread.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  subagentFromRecord,
  subagentIdentityParts,
  subagentRunStats,
  subagentResultSummaryLine,
  subagentRunUsageRows,
  type AgentFleetEntry,
  type AgentFleetRow,
} from "@t3tools/client-runtime/state/agent-fleet";
import {
  deriveSubagentToolCalls,
  subagentWorkspaceRoot,
} from "@t3tools/client-runtime/state/agent-list-view";
import {
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  OrchestrationV2ThreadShell,
  ProviderInstanceId,
  ScopedThreadRef,
  TurnItemId,
} from "@t3tools/contracts";
import { CheckIcon, CornerDownRightIcon, XIcon } from "lucide-react";
import { useMemo, useRef, type MouseEvent, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import { cn } from "~/lib/utils";
import {
  deriveProviderInstanceEntries,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import { useServerConfigs, useThreadProjection, useThreadShells } from "~/state/entities";
import { formatSecondsTimestamp } from "~/timestampFormat";

import { AgentElapsed, STATUS_VISUALS, StatusDot } from "../AgentStatus";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { AgentUsageFooter, ToolCallList } from "./AgentActivityParts";
import { AgentHandle } from "./AgentHandle";
import { showAgentInPanel } from "./agentContextMenu";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { SubagentActivityLine } from "./SubagentActivityLine";

export type ProviderEntries = ReadonlyMap<ProviderInstanceId, ProviderInstanceEntry>;

/** An environment's provider instances by id, for naming the provider each agent runs on. */
export function useProviderEntries(environmentId: ScopedThreadRef["environmentId"]) {
  const serverConfigs = useServerConfigs();
  return useMemo(
    (): ProviderEntries =>
      new Map(
        deriveProviderInstanceEntries(serverConfigs.get(environmentId)?.providers ?? []).map(
          (provider) => [provider.instanceId, provider],
        ),
      ),
    [environmentId, serverConfigs],
  );
}

/** The provider's glyph, dimmed and badged like the thread sidebar's. */
function AgentProviderIcon(props: { provider: ProviderInstanceEntry; providers: ProviderEntries }) {
  return (
    <ProviderInstanceIcon
      driverKind={props.provider.driverKind}
      displayName={props.provider.displayName}
      accentColor={props.provider.accentColor}
      acpRegistryAgentId={props.provider.acpRegistryAgentId}
      acpRegistryIconUrl={props.provider.acpRegistryIconUrl}
      showBadge={shouldShowInstanceBadge(props.provider, props.providers.values())}
      iconClassName="size-3.5 opacity-60"
      badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
    />
  );
}

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
export function AgentPreviewContent(props: {
  parentRef: ScopedThreadRef;
  entry: AgentFleetEntry;
  provider: ProviderInstanceEntry | undefined;
  workspaceRoot: string | null;
  onOpen: (toolCallId?: TurnItemId) => void;
}) {
  const { entry } = props;
  const record = useAgentRecord(props.parentRef, entry);
  // A nested agent's record arrives with its owner; until then the shell's view stands in.
  const agent: RuntimeSubagent = useMemo(
    () =>
      entry.subagent === null && record !== null
        ? { ...subagentFromRecord(record, entry.shell), status: entry.agent.status }
        : entry.agent,
    [entry.agent, entry.shell, entry.subagent, record],
  );
  const childRef =
    entry.childThreadId === null
      ? null
      : scopeThreadRef(props.parentRef.environmentId, entry.childThreadId);
  const child = useThreadProjection(childRef)?.projection ?? null;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const ownItems = useMemo(
    () =>
      child && entry.childThreadId !== null
        ? child.turnItems.filter((item) => item.threadId === entry.childThreadId)
        : [],
    [child, entry.childThreadId],
  );
  const calls = useMemo(
    () => deriveSubagentToolCalls(ownItems, props.workspaceRoot),
    [ownItems, props.workspaceRoot],
  );
  const agentRoot = useMemo(
    () => subagentWorkspaceRoot(ownItems, props.workspaceRoot),
    [ownItems, props.workspaceRoot],
  );
  const runStats = useMemo(
    () =>
      child && entry.childThreadId !== null
        ? subagentRunStats(child, entry.childThreadId)
        : { runs: 0, attempt: null },
    [child, entry.childThreadId],
  );
  const latest = useMemo(() => calls.slice(-PREVIEW_TOOL_CALLS).toReversed(), [calls]);
  const live = isActiveSubagentStatus(agent.status);
  const totalCalls = Math.max(calls.length, agent.usage?.toolUses ?? 0);
  const outcome = agent.error ?? (live ? null : agent.result);
  const prompt = record?.prompt.trim() || null;
  const identity = [
    STATUS_VISUALS[agent.status].label,
    ...(props.provider ? [props.provider.displayName] : []),
    ...subagentIdentityParts(agent, runStats.runs),
  ];
  return (
    <div className="flex cursor-pointer flex-col" onClick={() => props.onOpen()}>
      <div className="flex flex-col gap-0.5 border-b border-border/60 px-3 pt-2.5 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <StatusDot status={agent.status} />
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium">
            {entry.title}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 ps-3.5">
          <AgentHandle handle={entry.handle} />
          <span className="ms-auto shrink-0 font-mono text-2xs text-muted-foreground">
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
            {/* Hovering a call previews it; clicking opens the agent on it. */}
            <ToolCallList
              calls={latest}
              timestampFormat={timestampFormat}
              source={{
                environmentId: props.parentRef.environmentId,
                threadId: entry.childThreadId,
                workspaceRoot: agentRoot,
              }}
              onActivate={(call) => props.onOpen(call.id)}
            />
            {totalCalls > latest.length ? (
              <p className="ps-6.5 pt-1 text-2xs text-muted-foreground">
                {totalCalls - latest.length} more · click to open the agent
              </p>
            ) : null}
          </PreviewSection>
        ) : null}
      </div>
      <AgentUsageFooter usage={agent.usage} extra={subagentRunUsageRows(runStats)} />
    </div>
  );
}

export function AgentRow(props: {
  parentRef: ScopedThreadRef;
  row: AgentFleetRow;
  providers: ProviderEntries;
  workspaceRoot: string | null;
  /** Opens the agent; `toolCallId` opens it on that call. */
  onOpen: (entry: AgentFleetEntry, toolCallId?: TurnItemId) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, entry: AgentFleetEntry) => void;
  /** Alt-click: reference the agent in the chat's composer. */
  onReference?: (entry: AgentFleetEntry) => void;
}) {
  const { row } = props;
  const { entry } = row;
  const { agent } = entry;
  const provider = props.providers.get(entry.providerInstanceId);
  const previewActions = useRef<{ close: () => void; unmount: () => void } | null>(null);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const live = isActiveSubagentStatus(agent.status);
  const failed = agent.status === "failed";
  const open = (toolCallId?: TurnItemId) => {
    previewActions.current?.close();
    props.onOpen(entry, toolCallId);
  };
  // One truncated line; the full error stays in the preview and the agent tab.
  const error =
    failed && agent.error
      ? agent.error.length > 160
        ? `${agent.error.slice(0, 159)}…`
        : agent.error
      : null;
  const resultLine = agent.status === "completed" ? subagentResultSummaryLine(agent.result) : null;
  return (
    <PreviewCard actionsRef={previewActions}>
      <PreviewCardTrigger
        delay={400}
        closeDelay={150}
        render={
          <button
            type="button"
            onClick={(event) => {
              if (event.altKey && props.onReference) {
                previewActions.current?.close();
                props.onReference(entry);
                return;
              }
              open();
            }}
            onContextMenu={(event) => {
              previewActions.current?.close();
              props.onContextMenu(event, entry);
            }}
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
          {/* An instance since removed from settings keeps its slot so titles stay aligned. */}
          {provider ? (
            <AgentProviderIcon provider={provider} providers={props.providers} />
          ) : (
            <span aria-hidden className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
          {/* A fixed column, so handles of any length start at the same place. */}
          <span className="flex w-36 shrink-0">
            <AgentHandle handle={entry.handle} className="max-w-full" />
          </span>
          {agent.status === "completed" ? (
            <CheckIcon aria-hidden className="size-3 shrink-0 text-success" />
          ) : failed ? (
            <XIcon aria-hidden className="size-3 shrink-0 text-destructive" />
          ) : (
            // Holds the outcome icon's slot so handles line up across rows.
            <span aria-hidden className="size-3 shrink-0" />
          )}
          {/* Fixed widths keep the columns aligned across rows. */}
          <span className="w-[5ch] shrink-0 truncate text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
            {agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : ""}
          </span>
          <span className="w-[7ch] shrink-0 truncate text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
            <AgentElapsed agent={agent} />
          </span>
          <span className="min-w-[8ch] shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
            {agent.startedAt ? formatSecondsTimestamp(agent.startedAt, timestampFormat) : null}
          </span>
        </span>
        {live ? (
          <span className="flex h-5 min-w-0 items-center ps-3.5">
            <SubagentActivityLine
              childRef={
                entry.childThreadId === null
                  ? null
                  : scopeThreadRef(props.parentRef.environmentId, entry.childThreadId)
              }
              status={agent.status}
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
        ) : resultLine ? (
          <span className="flex h-5 min-w-0 items-center ps-3.5">
            <span className="min-w-0 truncate text-2xs text-muted-foreground">{resultLine}</span>
          </span>
        ) : null}
      </PreviewCardTrigger>
      <PreviewCardPopup side="left" align="start" className="w-100 max-w-[calc(100vw-2rem)]">
        <AgentPreviewContent
          parentRef={props.parentRef}
          entry={entry}
          provider={provider}
          workspaceRoot={props.workspaceRoot}
          onOpen={open}
        />
      </PreviewCardPopup>
    </PreviewCard>
  );
}
/**
 * Fork: an agent's row in the composer's `@` menu: who it is (status, provider, title, handle),
 * how it runs (model, effort, tokens, elapsed), and, while it works, its latest tool call.
 * Hovering previews it like an Agents panel row.
 */
export function AgentCommandRow(props: {
  parentRef: ScopedThreadRef;
  entry: AgentFleetEntry;
  workspaceRoot: string | null;
}) {
  const { entry } = props;
  const { agent } = entry;
  const providers = useProviderEntries(props.parentRef.environmentId);
  const provider = providers.get(entry.providerInstanceId);
  const live = isActiveSubagentStatus(agent.status);
  const identity = [
    STATUS_VISUALS[agent.status].label,
    ...(provider ? [provider.displayName] : []),
    ...subagentIdentityParts(agent),
  ];
  const row = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot status={agent.status} />
        {provider ? (
          <AgentProviderIcon provider={provider} providers={providers} />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-sans text-xs font-medium">{entry.title}</span>
        <span className="flex w-44 shrink-0">
          <AgentHandle handle={entry.handle} className="max-w-full" />
        </span>
        <span className="w-[5ch] shrink-0 truncate text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
          {agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : ""}
        </span>
        <span className="w-[7ch] shrink-0 truncate text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
          <AgentElapsed agent={agent} />
        </span>
      </span>
      <span className="truncate ps-9 font-mono text-2xs text-muted-foreground">
        {identity.join(" · ")}
      </span>
      {live ? (
        <span className="flex h-4 min-w-0 items-center ps-9">
          <SubagentActivityLine
            childRef={
              entry.childThreadId === null
                ? null
                : scopeThreadRef(props.parentRef.environmentId, entry.childThreadId)
            }
            status={agent.status}
            progress={agent.progress}
            workspaceRoot={props.workspaceRoot}
          />
        </span>
      ) : null}
    </span>
  );
  return (
    <CursorPreviewCard trigger={row} className="w-100 max-w-[calc(100vw-2rem)]" bare>
      <AgentPreviewContent
        parentRef={props.parentRef}
        entry={entry}
        provider={provider}
        workspaceRoot={props.workspaceRoot}
        onOpen={() => showAgentInPanel(props.parentRef, entry.key)}
      />
    </CursorPreviewCard>
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
