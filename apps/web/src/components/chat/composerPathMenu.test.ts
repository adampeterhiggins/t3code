import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { composerPathChatItems, resolveComposerPathTab } from "./composerPathMenu";

const defaults = {
  rangeStart: 2,
  choice: null,
  agentsAvailable: true,
  prefersAgents: false,
  prefersModels: false,
  query: "chat",
  chatCount: 1,
  fileCount: 0,
  filesLoading: false,
};

describe("resolveComposerPathTab", () => {
  it("keeps a manual tab for the current token, then returns to query selection", () => {
    const choice = { rangeStart: 2, tab: "files" as const };
    expect(resolveComposerPathTab({ ...defaults, choice, prefersModels: true })).toBe("files");
    expect(
      resolveComposerPathTab({ ...defaults, choice, rangeStart: 7, prefersModels: true }),
    ).toBe("models");
    expect(
      resolveComposerPathTab({ ...defaults, choice, rangeStart: null, prefersModels: true }),
    ).toBe("models");
  });

  it("ignores a manual Agents choice once agents are unavailable", () => {
    expect(
      resolveComposerPathTab({
        ...defaults,
        choice: { rangeStart: 2, tab: "agents" },
        agentsAvailable: false,
      }),
    ).toBe("chats");
  });

  it("prefers agent handles to model names, and model names to chat matches", () => {
    expect(resolveComposerPathTab({ ...defaults, prefersAgents: true, prefersModels: true })).toBe(
      "agents",
    );
    expect(resolveComposerPathTab({ ...defaults, prefersModels: true })).toBe("models");
    expect(resolveComposerPathTab(defaults)).toBe("chats");
  });

  it("waits for files before automatically choosing Chats and keeps blank queries on Files", () => {
    expect(resolveComposerPathTab({ ...defaults, filesLoading: true })).toBe("files");
    expect(resolveComposerPathTab({ ...defaults, fileCount: 1 })).toBe("files");
    expect(resolveComposerPathTab({ ...defaults, query: "  " })).toBe("files");
    expect(resolveComposerPathTab({ ...defaults, chatCount: 0 })).toBe("files");
  });
});

it("lists matching sibling tabs first and excludes their duplicate thread results", () => {
  const environmentId = EnvironmentId.make("env");
  const activeThreadId = ThreadId.make("current");
  const sibling = ThreadId.make("sibling");
  const other = ThreadId.make("other");
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" };
  const items = composerPathChatItems({
    query: " FIX ",
    activeThreadId,
    threadTabs: [
      { threadId: activeThreadId, title: "Fix current", modelSelection },
      { threadId: sibling, title: "Fix sibling", modelSelection },
      { threadId: ThreadId.make("unmatched"), title: "Other tab", modelSelection },
    ],
    items: [
      {
        id: "sibling-result",
        type: "thread",
        thread: { environmentId, threadId: sibling },
        label: "Fix sibling",
        description: "",
      },
      {
        id: "other-result",
        type: "thread",
        thread: { environmentId, threadId: other },
        label: "Fix other",
        description: "",
      },
    ],
  });
  expect(items.map((item) => item.id)).toEqual([`thread-tab:${sibling}`, "other-result"]);
});
