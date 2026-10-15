export type ThreadTabSummaryRole = "user" | "assistant" | "reasoning" | "tools" | "error";

export type ThreadTabSummaryBlock =
  | { readonly kind: "entry"; readonly role: ThreadTabSummaryRole; readonly text: string }
  | { readonly kind: "omitted"; readonly turns: number };

export interface ThreadTabSummaryChat {
  readonly title: string;
  readonly latestTurn: string | null;
  readonly files: ReadonlyArray<string>;
  readonly moreFiles: number;
  readonly plan: string | null;
  readonly blocks: ReadonlyArray<ThreadTabSummaryBlock>;
}

const ENTRY_LINE = /^(User|Assistant|Reasoning \(excerpt\)|Tools|Error): /;
const ROLES: Record<string, ThreadTabSummaryRole> = {
  User: "user",
  Assistant: "assistant",
  "Reasoning (excerpt)": "reasoning",
  Tools: "tools",
  Error: "error",
};

/**
 * Reads the chat handoff text from `summarizeSiblingChat` (`apps/server/src/threadTabs/summary.ts`)
 * back into its parts, one chat per source. Returns null for text in any other shape, such as a
 * subagent's captured work, which callers show as plain text.
 */
export function parseThreadTabSummary(summary: string): ThreadTabSummaryChat[] | null {
  type MutableChat = {
    title: string;
    latestTurn: string | null;
    files: string[];
    moreFiles: number;
    plan: string | null;
    blocks: Array<
      | { kind: "entry"; role: ThreadTabSummaryRole; text: string }
      | { kind: "omitted"; turns: number }
    >;
  };
  const chats: MutableChat[] = [];
  let section: "header" | "files" | "plan" = "header";
  for (const line of summary.split("\n")) {
    if (line.startsWith("Source thread: ")) continue;
    if (line.startsWith("Related chat: ")) {
      chats.push({
        title: line.slice("Related chat: ".length).trim(),
        latestTurn: null,
        files: [],
        moreFiles: 0,
        plan: null,
        blocks: [],
      });
      section = "header";
      continue;
    }
    const chat = chats.at(-1);
    if (chat === undefined) {
      if (line.trim().length > 0) return null;
      continue;
    }
    const entry = ENTRY_LINE.exec(line);
    if (entry) {
      chat.blocks.push({
        kind: "entry",
        role: ROLES[entry[1]!]!,
        text: line.slice(entry[0].length),
      });
      continue;
    }
    const omitted = /^\[(\d+) turns? omitted\]$/.exec(line);
    if (omitted) {
      chat.blocks.push({ kind: "omitted", turns: Number(omitted[1]) });
      continue;
    }
    const last = chat.blocks.at(-1);
    if (last?.kind === "entry") {
      last.text += `\n${line}`;
      continue;
    }
    if (line.startsWith("Latest turn: ")) {
      chat.latestTurn = line.slice("Latest turn: ".length);
      section = "header";
    } else if (line === "Files changed:") section = "files";
    else if (line === "Latest plan:") {
      section = "plan";
      chat.plan = "";
    } else if (section === "plan") chat.plan += `${chat.plan ? "\n" : ""}${line}`;
    else if (section === "files" && line.startsWith("- …and ")) {
      chat.moreFiles = Number.parseInt(line.slice("- …and ".length)) || 0;
    } else if (section === "files" && line.startsWith("- ")) chat.files.push(line.slice(2));
  }
  if (chats.length === 0) return null;
  return chats.map((chat) => ({
    ...chat,
    plan: chat.plan?.trim() || null,
    blocks: chat.blocks
      .map((block) => (block.kind === "entry" ? { ...block, text: block.text.trim() } : block))
      .filter((block) => block.kind !== "entry" || block.text.length > 0),
  }));
}

/** The calls of a `tools` entry, each with whether it failed. */
export function threadTabSummaryTools(text: string) {
  return text.split(" · ").map((label) => {
    const failed = label.endsWith(" (failed)");
    return { label: failed ? label.slice(0, -" (failed)".length) : label, failed };
  });
}
