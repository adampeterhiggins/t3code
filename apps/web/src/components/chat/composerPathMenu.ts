import type { ThreadId, ThreadTabGroup } from "@t3tools/contracts";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

export type ComposerPathTab = "files" | "chats" | "agents" | "models";

export function composerPathChatItems({
  query,
  threadTabs,
  activeThreadId,
  items,
}: {
  query: string;
  threadTabs: ThreadTabGroup["tabs"];
  activeThreadId: ThreadId | null;
  items: ReadonlyArray<ComposerCommandItem>;
}): ComposerCommandItem[] {
  const tabQuery = query.trim().toLowerCase();
  const tabs = threadTabs;
  const tabThreadIds = new Set(tabs.map((tab) => tab.threadId));
  return [
    ...tabs
      .filter(
        (tab) => tab.threadId !== activeThreadId && tab.title.toLowerCase().includes(tabQuery),
      )
      .map((tab) => ({
        id: `thread-tab:${tab.threadId}`,
        type: "thread-tab" as const,
        threadId: tab.threadId,
        label: tab.title,
        description: "Chat tab",
      })),
    ...items.filter((item) => item.type === "thread" && !tabThreadIds.has(item.thread.threadId)),
  ];
}

export function resolveComposerPathTab(input: {
  rangeStart: number | null;
  choice: { rangeStart: number; tab: ComposerPathTab } | null;
  agentsAvailable: boolean;
  prefersAgents: boolean;
  prefersModels: boolean;
  query: string;
  chatCount: number;
  fileCount: number;
  filesLoading: boolean;
}): ComposerPathTab {
  if (
    input.rangeStart !== null &&
    input.choice?.rangeStart === input.rangeStart &&
    (input.choice.tab !== "agents" || input.agentsAvailable)
  )
    return input.choice.tab;
  if (input.prefersAgents) return "agents";
  if (input.prefersModels) return "models";
  return input.query.trim().length > 0 &&
    input.chatCount > 0 &&
    !input.filesLoading &&
    input.fileCount === 0
    ? "chats"
    : "files";
}
