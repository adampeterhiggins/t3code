import type { MessageId, OrchestrationV2TurnItem } from "@t3tools/contracts";

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

/**
 * A chat as the summary reads it: its timeline items in display order, including history a fork
 * inherited (`visibleTurnItems` of the v2 projection).
 */
export interface SiblingChatSource {
  readonly title: string;
  readonly worktreePath?: string | null;
  /** Status of the chat's latest run, shown as `Latest turn:`. */
  readonly latestRunStatus?: string | null;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
}

/**
 * The chat as it stood just before a user message, for forking from that message. Null when the
 * message is not one of the chat's user messages.
 */
export function siblingChatBeforeMessage(
  source: SiblingChatSource,
  messageId: MessageId,
): SiblingChatSource | null {
  const index = source.items.findIndex(
    (item) => item.type === "user_message" && item.messageId === messageId,
  );
  if (index === -1) return null;
  // The latest run is at or after the cutoff, so its status says nothing about this history.
  return { ...source, latestRunStatus: null, items: source.items.slice(0, index) };
}

/** The chat through a completed assistant response, ready for a follow-up in a new tab. */
export function siblingChatThroughMessage(
  source: SiblingChatSource,
  messageId: MessageId,
): SiblingChatSource | null {
  const index = source.items.findIndex(
    (item) => item.type === "assistant_message" && item.messageId === messageId,
  );
  const cutoff = source.items[index];
  if (cutoff?.type !== "assistant_message" || cutoff.streaming) return null;
  // The response's checkpoint lands after it, and its files belong to this history.
  const checkpoints = source.items
    .slice(index + 1)
    .filter(
      (item) => item.type === "checkpoint" && item.runId !== null && item.runId === cutoff.runId,
    );
  return {
    ...source,
    latestRunStatus: null,
    items: [...source.items.slice(0, index + 1), ...checkpoints],
  };
}

type Entry =
  | { readonly kind: "user" | "assistant" | "reasoning"; readonly text: string }
  | { readonly kind: "tool" | "error"; readonly label: string };

/**
 * A bounded, extractive handoff of another chat: dialogue plus compact traces of reasoning,
 * tool calls, errors, changed files and the latest plan. The source chat remains the authority,
 * so when the budget runs out the oldest turns go first; the opening request always stays.
 *
 * The web attach picker parses this text for its preview (`parseThreadSummaryPreview` in
 * `apps/web/src/components/chat/threadAttachPickerSummary.ts`), so keep the line prefixes stable.
 */
export function summarizeSiblingChat(source: SiblingChatSource): string {
  const root = source.worktreePath;
  const shorten = (text: string) =>
    root ? text.replaceAll(`${root}/`, "").replaceAll(`cd ${root} && `, "") : text;

  const entries = source.items.flatMap((item) => entryFor(item, shorten));

  // Each user message opens a turn; anything before the first one is its own preamble turn.
  const turns: Entry[][] = [];
  for (const entry of entries) {
    if (turns.length === 0 || entry.kind === "user") turns.push([]);
    turns.at(-1)!.push(entry);
  }
  const renderedTurns = turns.map(renderTurn).filter((turn) => turn.length > 0);

  const header = [`Related chat: ${source.title}`];
  if (source.latestRunStatus) header.push(`Latest turn: ${source.latestRunStatus}`);
  const files = changedFiles(source.items);
  if (files.length > 0) {
    header.push(
      `Files changed:\n${files
        .slice(0, MAX_FILES)
        .map((file) => `- ${shorten(file)}`)
        .join("\n")}${files.length > MAX_FILES ? `\n- …and ${files.length - MAX_FILES} more` : ""}`,
    );
  }
  const plan = source.items.findLast(
    (item) => item.type === "proposed_plan" && !item.streaming && item.markdown.trim().length > 0,
  );
  if (plan?.type === "proposed_plan") {
    header.push(`Latest plan:\n${clip(plan.markdown.trim(), MAX_PLAN_CHARS)}`);
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

function entryFor(item: OrchestrationV2TurnItem, shorten: (text: string) => string): Entry[] {
  const failed = item.status === "failed" ? " (failed)" : "";
  const tool = (label: string): Entry[] => [
    { kind: "tool", label: oneLine(shorten(label), MAX_TOOL_LABEL_CHARS) + failed },
  ];
  switch (item.type) {
    case "user_message":
      return item.text.trim().length > 0 ? [{ kind: "user", text: item.text }] : [];
    case "assistant_message":
      return !item.streaming && item.text.trim().length > 0
        ? [{ kind: "assistant", text: item.text }]
        : [];
    case "reasoning":
      return !item.streaming && item.text.trim().length > 0
        ? [{ kind: "reasoning", text: item.text }]
        : [];
    case "command_execution": {
      const exitedNonZero = item.exitCode !== undefined && item.exitCode !== 0;
      return [
        {
          kind: "tool",
          label:
            oneLine(
              `Command: ${shorten(item.input.replace(/^(?:\/bin\/)?(?:ba|z)?sh -l?c /, ""))}`,
              MAX_TOOL_LABEL_CHARS,
            ) + (failed || exitedNonZero ? " (failed)" : ""),
        },
      ];
    }
    case "file_change":
      return tool(`Edit: ${item.fileName}`);
    case "file_search":
      return tool(`Search: ${item.pattern ?? item.title ?? "files"}`);
    case "web_search":
      return tool(`Web search: ${item.patterns?.join(", ") ?? item.title ?? ""}`);
    case "dynamic_tool": {
      const input = toolInput(item.input);
      const name = item.toolName ?? item.title ?? "Tool";
      return tool(input ? `${name}: ${input}` : name);
    }
    case "subagent":
      return tool(`Subagent: ${item.prompt}`);
    case "error":
      return [{ kind: "error", label: oneLine(shorten(item.failure.message), MAX_ERROR_CHARS) }];
    default:
      return [];
  }
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
    switch (entry.kind) {
      case "tool":
        tools.push(entry.label);
        continue;
      case "error":
        flushTools();
        lines.push(`Error: ${entry.label}`);
        continue;
      case "user":
        flushTools();
        lines.push(`User: ${clip(entry.text.trim(), MAX_USER_CHARS)}`);
        continue;
      case "assistant":
        flushTools();
        lines.push(`Assistant: ${clip(entry.text.trim(), MAX_ASSISTANT_CHARS)}`);
        continue;
      case "reasoning":
        flushTools();
        lines.push(`Reasoning (excerpt): ${clip(entry.text.trim(), MAX_REASONING_CHARS)}`);
        continue;
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

/** The most telling field of a dynamic tool's input, wherever the provider nests it. */
function toolInput(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined;
  const key = TOOL_INPUT_KEYS.find((entry) => typeof record?.[entry] === "string");
  return record && key ? (record[key] as string) : undefined;
}

/** Every file the chat's checkpoints touched, most recently changed first. */
function changedFiles(items: ReadonlyArray<OrchestrationV2TurnItem>): string[] {
  const totals = new Map<string, { additions: number; deletions: number }>();
  for (const item of items.toReversed()) {
    if (item.type !== "checkpoint") continue;
    for (const file of item.files) {
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
