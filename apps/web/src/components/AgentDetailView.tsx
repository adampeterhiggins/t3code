/**
 * One agent, in full: identity, usage breakdown, launch prompt, outcome, the
 * tool calls the thread recorded for it, and (on request) the provider's own
 * transcript. The transcript is fetched only when asked for and never streams.
 */
import {
  deriveSubagentToolLog,
  type SubagentToolLogEntry,
} from "@t3tools/client-runtime/state/agentPanelView";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  SubagentTranscriptEntry,
  ThreadId,
} from "@t3tools/contracts";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";

import { AgentElapsed, elapsedBetween, STATUS_VISUALS, StatusDot } from "./AgentStatus";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

function Section(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-0.5">
        <h3 className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          {props.title}
        </h3>
        {props.action ? (
          <div className="ml-auto flex items-center gap-1">{props.action}</div>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

function TextBlock(props: { text: string; tone?: "default" | "error" }) {
  return (
    <pre
      className={cn(
        "max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/60 p-2 font-mono text-2xs leading-relaxed",
        props.tone === "error" ? "text-destructive-foreground" : "text-foreground/90",
      )}
    >
      {props.text}
    </pre>
  );
}

function UsageGrid({ agent }: { agent: RuntimeSubagent }) {
  const usage = agent.usage;
  const cells: Array<[string, string]> = [];
  if (usage) {
    cells.push(["Tokens", formatSubagentTokenCount(usage.totalTokens)]);
    if (usage.inputTokens !== undefined)
      cells.push(["Input", formatSubagentTokenCount(usage.inputTokens)]);
    if (usage.cachedInputTokens !== undefined)
      cells.push(["Cached", formatSubagentTokenCount(usage.cachedInputTokens)]);
    if (usage.outputTokens !== undefined)
      cells.push(["Output", formatSubagentTokenCount(usage.outputTokens)]);
    if (usage.reasoningOutputTokens !== undefined)
      cells.push(["Reasoning", formatSubagentTokenCount(usage.reasoningOutputTokens)]);
    if (usage.toolUses !== undefined) cells.push(["Tool calls", String(usage.toolUses)]);
  }
  if (agent.activationCount > 1) cells.push(["Runs", String(agent.activationCount)]);
  if (agent.attempt !== null && agent.attempt > 1) cells.push(["Attempt", String(agent.attempt)]);
  if (cells.length === 0) return null;
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-md border border-border/60 px-2 py-1.5">
      {cells.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col">
          <dt className="text-3xs uppercase tracking-wider text-muted-foreground/80">{label}</dt>
          <dd className="truncate font-mono text-xs tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TOOL_STATUS_DOT: Record<SubagentToolLogEntry["status"], RuntimeSubagent["status"]> = {
  running: "running",
  completed: "completed",
  failed: "failed",
};

function ToolLogRow({ entry }: { entry: SubagentToolLogEntry }) {
  const summary = (
    <span className="grid grid-cols-[0.375rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
      <span className="flex translate-y-[-0.1rem] items-center">
        <StatusDot status={TOOL_STATUS_DOT[entry.status]} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs">{entry.title}</span>
        {entry.detail ? (
          <span className="block truncate font-mono text-2xs text-muted-foreground">
            {entry.detail}
          </span>
        ) : null}
      </span>
      <span className="font-mono text-2xs tabular-nums text-muted-foreground/80">
        {entry.completedAt ? elapsedBetween(entry.startedAt, entry.completedAt) : "…"}
      </span>
    </span>
  );
  // The detail line truncates; opening the row shows it whole.
  return entry.detail ? (
    <li>
      <details className="rounded-sm px-1 py-0.5 hover:bg-accent/30">
        <summary className="cursor-pointer list-none">{summary}</summary>
        <div className="mt-1">
          <TextBlock text={entry.detail} />
        </div>
      </details>
    </li>
  ) : (
    <li className="px-1 py-0.5">{summary}</li>
  );
}

function ToolLog({ entries }: { entries: ReadonlyArray<SubagentToolLogEntry> }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => (
        <ToolLogRow key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}

const TRANSCRIPT_LABELS: Record<SubagentTranscriptEntry["kind"], string> = {
  user: "Prompt",
  assistant: "Agent",
  reasoning: "Thinking",
  tool: "Tool",
};

function TranscriptEntryView({ entry }: { entry: SubagentTranscriptEntry }) {
  if (entry.kind === "tool") {
    const hasBody = entry.input !== undefined || entry.output !== undefined;
    const title = (
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "shrink-0 font-mono text-3xs uppercase",
            entry.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {entry.toolName ?? "tool"}
        </span>
        <span className="min-w-0 truncate text-xs">{entry.text}</span>
      </span>
    );
    return hasBody ? (
      <details className="rounded-sm px-1 py-0.5 hover:bg-accent/30">
        <summary className="cursor-pointer list-none">{title}</summary>
        <div className="mt-1 flex flex-col gap-1">
          {entry.input !== undefined ? <TextBlock text={entry.input} /> : null}
          {entry.output !== undefined ? (
            <TextBlock text={entry.output} tone={entry.status === "failed" ? "error" : "default"} />
          ) : null}
        </div>
      </details>
    ) : (
      <div className="px-1 py-0.5">{title}</div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 px-1 py-1">
      <span className="font-mono text-3xs uppercase text-muted-foreground">
        {TRANSCRIPT_LABELS[entry.kind]}
      </span>
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-xs leading-relaxed",
          entry.kind === "reasoning" ? "italic text-muted-foreground" : "text-foreground/90",
        )}
      >
        {entry.text}
      </p>
    </div>
  );
}

function TranscriptSection(props: {
  agent: RuntimeSubagent;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const [requested, setRequested] = useState(false);
  const query = useEnvironmentQuery(
    requested
      ? orchestrationEnvironment.subagentTranscript({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, taskId: props.agent.id },
        })
      : null,
  );
  return (
    <Section
      title="Transcript"
      action={
        requested ? (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Refresh transcript"
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshCw aria-hidden />
          </Button>
        ) : null
      }
    >
      {!requested ? (
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          onClick={() => setRequested(true)}
        >
          Load transcript
        </Button>
      ) : query.data ? (
        query.data.entries.length === 0 ? (
          <p className="px-0.5 text-xs text-muted-foreground">The transcript is empty.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/40 rounded-md border border-border/60">
            {query.data.truncated ? (
              <p className="px-2 py-1 text-2xs text-muted-foreground">
                Showing the latest entries.
              </p>
            ) : null}
            {query.data.entries.map((entry, index) => (
              <TranscriptEntryView key={index} entry={entry} />
            ))}
          </div>
        )
      ) : query.error ? (
        <p className="px-0.5 text-xs text-muted-foreground">{query.error}</p>
      ) : (
        <p className="px-0.5 text-xs text-muted-foreground">Loading…</p>
      )}
    </Section>
  );
}

export function AgentDetailView(props: {
  agent: RuntimeSubagent;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onBack: () => void;
}) {
  const { agent } = props;
  const toolLog = useMemo(
    () => deriveSubagentToolLog(props.activities, agent.id),
    [props.activities, agent.id],
  );
  const live = isActiveSubagentStatus(agent.status);
  const identity = [
    STATUS_VISUALS[agent.status].label,
    agent.role,
    formatSubagentModelLabel(agent.model, agent.effort),
    agent.phaseTitle ? `phase ${agent.phaseTitle}` : null,
  ].filter((value): value is string => value !== null);
  const outcome = agent.error ?? (live ? null : agent.result);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1 border-b border-border/60 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost-muted" onClick={props.onBack}>
            <ChevronLeft aria-hidden />
            Agents
          </Button>
          <span className="ml-auto pr-1 font-mono text-2xs text-muted-foreground/80">
            <AgentElapsed agent={agent} />
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 px-1">
          <StatusDot status={agent.status} />
          <h2 className="min-w-0 truncate text-sm font-medium">{agent.title}</h2>
        </div>
        <p className="truncate px-1 font-mono text-2xs text-muted-foreground">
          {identity.join(" · ")}
        </p>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          <UsageGrid agent={agent} />
          {live && agent.progress ? (
            <Section title="Now">
              <p className="px-0.5 text-xs text-muted-foreground">{agent.progress}</p>
            </Section>
          ) : null}
          {agent.prompt ? (
            <Section title="Prompt">
              <TextBlock text={agent.prompt} />
            </Section>
          ) : null}
          {outcome ? (
            <Section title={agent.error ? "Error" : "Result"}>
              <TextBlock text={outcome} tone={agent.error ? "error" : "default"} />
            </Section>
          ) : null}
          <Section title={`Tool calls${toolLog.length > 0 ? ` · ${toolLog.length}` : ""}`}>
            {toolLog.length > 0 ? (
              <ToolLog entries={toolLog} />
            ) : agent.recentActivity.length > 0 ? (
              <ol className="flex flex-col px-1">
                {agent.recentActivity.map((entry) => (
                  <li key={`${entry.at}:${entry.summary}`} className="truncate text-xs">
                    {entry.summary}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-0.5 text-xs text-muted-foreground">
                This provider did not report the agent's tool calls.
              </p>
            )}
          </Section>
          {props.environmentId && props.threadId ? (
            <TranscriptSection
              agent={agent}
              environmentId={props.environmentId}
              threadId={props.threadId}
            />
          ) : null}
          {agent.outputFile || agent.runHandles?.sessionUrl ? (
            <Section title="Artifacts">
              {agent.outputFile ? (
                <p className="break-all px-0.5 font-mono text-2xs text-muted-foreground">
                  {agent.outputFile}
                </p>
              ) : null}
              {agent.runHandles?.sessionUrl ? (
                <a
                  href={agent.runHandles.sessionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-0.5 text-xs text-info-foreground hover:underline"
                >
                  Open remote session
                </a>
              ) : null}
            </Section>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
