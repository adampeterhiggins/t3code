import type {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";

const MAX_SUMMARY_CHARS = 16_000;
const MAX_OPENING_TURN_CHARS = 4_000;
const MIN_PARTIAL_TURN_CHARS = 600;
const MAX_USER_CHARS = 2_000;
const MAX_ASSISTANT_CHARS = 2_400;
const MAX_REASONING_CHARS = 300;
const MAX_TOOL_LABEL_CHARS = 110;
const MAX_TOOLS_PER_RUN = 8;
const MAX_FILES = 20;
const MAX_PLAN_CHARS = 3_000;
const MAX_ERROR_CHARS = 300;

export interface SiblingChatSource {
  readonly title: string;
  readonly worktreePath?: string | null;
  readonly latestTurnState?: string | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoints?: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly proposedPlans?: ReadonlyArray<OrchestrationProposedPlan>;
}

/**
 * The chat as it stood just before a user message, for forking from that message. Null when the
 * message is not one of the chat's user messages.
 */
export function siblingChatBeforeMessage(
  source: SiblingChatSource,
  messageId: string,
): SiblingChatSource | null {
  const index = source.messages.findIndex((message) => message.id === messageId);
  const cutoff = source.messages[index];
  if (!cutoff || cutoff.role !== "user") return null;
  const before = (at: string) => at < cutoff.createdAt;
  return {
    ...source,
    // The latest turn is at or after the cutoff, so its state says nothing about this history.
    latestTurnState: null,
    messages: source.messages.slice(0, index),
    activities: (source.activities ?? []).filter((activity) => before(activity.createdAt)),
    checkpoints: (source.checkpoints ?? []).filter((checkpoint) => before(checkpoint.completedAt)),
    proposedPlans: (source.proposedPlans ?? []).filter((plan) => before(plan.createdAt)),
  };
}

type Entry =
  | { readonly at: string; readonly kind: "message"; readonly message: OrchestrationMessage }
  | { readonly at: string; readonly kind: "tool"; readonly label: string }
  | { readonly at: string; readonly kind: "error"; readonly label: string };

/**
 * A bounded, extractive handoff of a sibling tab: dialogue plus compact traces of reasoning,
 * tool calls, errors, changed files and the latest plan. The source chat remains the authority,
 * so when the budget runs out the oldest turns go first; the opening request always stays.
 */
export function summarizeSiblingChat(source: SiblingChatSource): string {
  const root = source.worktreePath;
  const shorten = (text: string) =>
    root ? text.replaceAll(`${root}/`, "").replaceAll(`cd ${root} && `, "") : text;

  const entries: Entry[] = [
    ...source.messages
      .filter((message) => !message.streaming && message.text.trim().length > 0)
      .filter((message) => message.role !== "system")
      .map((message) => ({ at: message.createdAt, kind: "message" as const, message })),
    ...(source.activities ?? []).flatMap((activity): Entry[] => {
      if (activity.kind === "tool.completed") {
        return [{ at: activity.createdAt, kind: "tool", label: toolLabel(activity, shorten) }];
      }
      if (activity.tone === "error") {
        return [{ at: activity.createdAt, kind: "error", label: errorLabel(activity, shorten) }];
      }
      return [];
    }),
  ].toSorted((left, right) => left.at.localeCompare(right.at));

  // Each user message opens a turn; anything before the first one is its own preamble turn.
  const turns: Entry[][] = [];
  for (const entry of entries) {
    if (turns.length === 0 || (entry.kind === "message" && entry.message.role === "user")) {
      turns.push([]);
    }
    turns.at(-1)!.push(entry);
  }
  const renderedTurns = turns.map(renderTurn).filter((turn) => turn.length > 0);

  const header = [`Related chat: ${source.title}`];
  if (source.latestTurnState) header.push(`Latest turn: ${source.latestTurnState}`);
  const files = changedFiles(source.checkpoints ?? []);
  if (files.length > 0) {
    header.push(
      `Files changed:\n${files
        .slice(0, MAX_FILES)
        .map((file) => `- ${shorten(file)}`)
        .join("\n")}${files.length > MAX_FILES ? `\n- …and ${files.length - MAX_FILES} more` : ""}`,
    );
  }
  const plan = source.proposedPlans
    ?.toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
  if (plan) {
    header.push(
      `Latest plan${plan.implementedAt ? " (implemented)" : ""}:\n${clip(plan.planMarkdown.trim(), MAX_PLAN_CHARS)}`,
    );
  }
  const head = header.join("\n\n");

  // Keep the opening turn, then fill the remaining budget with the newest turns. The oldest
  // turn that only partly fits is clipped rather than dropped when enough room is left.
  let budget = MAX_SUMMARY_CHARS - head.length - 64;
  const [openingTurn, ...rest] = renderedTurns;
  const first =
    openingTurn === undefined
      ? undefined
      : clip(openingTurn, rest.length > 0 ? MAX_OPENING_TURN_CHARS : budget);
  budget -= first?.length ?? 0;
  const recent: string[] = [];
  for (const turn of rest.toReversed()) {
    if (turn.length + 2 <= budget) {
      recent.unshift(turn);
      budget -= turn.length + 2;
      continue;
    }
    if (budget >= MIN_PARTIAL_TURN_CHARS) recent.unshift(clip(turn, budget - 2));
    break;
  }
  const omitted = rest.length - recent.length;
  const body = [
    first,
    omitted > 0 ? `[${omitted} ${omitted === 1 ? "turn" : "turns"} omitted]` : undefined,
    ...recent,
  ].filter((part) => part !== undefined);
  return [head, ...body].join("\n\n").slice(0, MAX_SUMMARY_CHARS);
}

function renderTurn(turn: ReadonlyArray<Entry>): string {
  const lines: string[] = [];
  let tools: string[] = [];
  const flushTools = () => {
    if (tools.length === 0) return;
    const shown = [...new Set(tools)];
    const extra = shown.length - MAX_TOOLS_PER_RUN;
    lines.push(
      `Tools: ${shown.slice(0, MAX_TOOLS_PER_RUN).join(" · ")}${extra > 0 ? ` · +${extra} more` : ""}`,
    );
    tools = [];
  };
  for (const entry of turn) {
    if (entry.kind === "tool") {
      tools.push(entry.label);
      continue;
    }
    flushTools();
    if (entry.kind === "error") {
      lines.push(`Error: ${entry.label}`);
      continue;
    }
    const text = entry.message.text.trim();
    switch (entry.message.role) {
      case "user":
        lines.push(`User: ${clip(text, MAX_USER_CHARS)}`);
        break;
      case "assistant":
        lines.push(`Assistant: ${clip(text, MAX_ASSISTANT_CHARS)}`);
        break;
      case "reasoning":
        lines.push(`Reasoning (excerpt): ${clip(text, MAX_REASONING_CHARS)}`);
        break;
    }
  }
  flushTools();
  return lines.join("\n");
}

/** Keeps the start and end of long text, where requests and conclusions usually live. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.floor(max / 3);
  return `${text.slice(0, max - tail - 3).trimEnd()} … ${text.slice(-tail).trimStart()}`;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const TOOL_INPUT_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "description"];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/** The most telling input field of a tool call, wherever this provider nests its input. */
function toolInput(data: Record<string, unknown> | undefined): string | undefined {
  for (const candidate of [data?.input, data?.rawInput, data?.item, data]) {
    const record = asRecord(candidate);
    const key = TOOL_INPUT_KEYS.find((entry) => typeof record?.[entry] === "string");
    if (record && key) return record[key] as string;
  }
  return undefined;
}

/**
 * One short line per tool call. Providers disagree on where the useful part lives: some put it
 * in the summary ("Read a.ts (1 - 20)"), others behind a generic summary ("Command run") with a
 * truncated `detail` and the full input under `data`, which is preferred when present.
 */
function toolLabel(
  activity: OrchestrationThreadActivity,
  shorten: (text: string) => string,
): string {
  const payload = asRecord(activity.payload) ?? {};
  const data = asRecord(payload.data);
  const detail = typeof payload.detail === "string" ? payload.detail : "";
  const failed = payload.status === "failed" ? " (failed)" : "";
  const summary = shorten(activity.summary);
  if (!detail || summary.includes(detail)) return oneLine(summary, MAX_TOOL_LABEL_CHARS) + failed;

  const toolName = typeof data?.toolName === "string" ? data.toolName : summary;
  const input = (toolInput(data) ?? detail.replace(/^[\w.-]+: /, "")).replace(
    /^(?:\/bin\/)?(?:ba|z)?sh -l?c /,
    "",
  );
  return oneLine(`${toolName}: ${shorten(input)}`, MAX_TOOL_LABEL_CHARS) + failed;
}

function errorLabel(
  activity: OrchestrationThreadActivity,
  shorten: (text: string) => string,
): string {
  const payload = activity.payload as { readonly detail?: unknown } | null;
  const detail = typeof payload?.detail === "string" ? payload.detail : "";
  const label = detail ? `${activity.summary}: ${detail}` : activity.summary;
  return oneLine(shorten(label), MAX_ERROR_CHARS);
}

/** Every file the window's checkpoints touched, most recently changed first. */
function changedFiles(checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>): string[] {
  const totals = new Map<string, { additions: number; deletions: number }>();
  const newestFirst = checkpoints.toSorted((a, b) => b.completedAt.localeCompare(a.completedAt));
  for (const checkpoint of newestFirst) {
    for (const file of checkpoint.files) {
      const total = totals.get(file.path) ?? { additions: 0, deletions: 0 };
      total.additions += file.additions;
      total.deletions += file.deletions;
      totals.set(file.path, total);
    }
  }
  return [...totals].map(
    ([path, { additions, deletions }]) => `${path} (+${additions} −${deletions})`,
  );
}
