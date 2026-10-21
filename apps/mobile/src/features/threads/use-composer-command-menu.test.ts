import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const refreshProviders = vi.hoisted(() => vi.fn());
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("../../state/queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: vi.fn(),
  useComposerDraft: () => ({ text: "", attachments: [] }),
  readComposerDraftSelection: vi.fn(),
  setComposerDraftContext: vi.fn(),
}));
vi.mock("../../state/threads", () => ({
  useEnvironmentThread: () => ({ data: { _tag: "None" } }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "context-id" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { refreshProviders: Symbol("refreshProviders") },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => refreshProviders,
}));

import { getComposerDraftSnapshot, setComposerDraftContext } from "../../state/use-composer-drafts";
import {
  useComposerCommandMenu,
  buildComposerSlashCommandItems,
  resolveComposerCommandSelection,
} from "./use-composer-command-menu";

describe("mobile slash commands", () => {
  const antigravity = {
    driver: ProviderDriverKind.make("antigravity"),
    showInteractionModeToggle: false,
    slashCommands: [{ name: "plan", description: "Plan with Antigravity" }],
  };

  it.each([false, true])(
    "keeps native /plan with legacy mode enabled=%s",
    (allowInteractionMode) => {
      const items = buildComposerSlashCommandItems({
        query: "pl",
        atMessageStart: true,
        hasThread: true,
        allowInteractionMode,
        selectedProviderStatus: antigravity,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.type).toBe("provider-slash-command");
      const item = items[0];
      if (!item) throw new Error("Expected the native plan command");
      expect(
        resolveComposerCommandSelection({
          draftMessage: "/pl",
          trigger: { rangeStart: 0, rangeEnd: 3 },
          item,
          allowInteractionMode,
        }),
      ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
    },
  );

  it("still applies the T3 plan command for supported providers", () => {
    const items = buildComposerSlashCommandItems({
      query: "plan",
      atMessageStart: true,
      hasThread: true,
      allowInteractionMode: true,
      selectedProviderStatus: {
        driver: ProviderDriverKind.make("codex"),
        slashCommands: [],
      },
    });
    const item = items[0];
    if (!item) throw new Error("Expected the T3 plan command");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: true,
      }),
    ).toEqual({ text: "", cursor: 0, interactionMode: "plan" });

    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: false,
      }),
    ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
  });
});

describe("@ menu agents", () => {
  let root: Root;
  const environmentId = EnvironmentId.make("test-environment");
  const threadId = ThreadId.make("parent");
  const subagent = (id: string, title: string): OrchestrationV2Subagent =>
    ({
      id: NodeId.make(id),
      threadId,
      runId: null,
      parentNodeId: NodeId.make("root"),
      origin: "provider_native",
      createdBy: "provider",
      driver: "claudeAgent",
      providerInstanceId: ProviderInstanceId.make("claude"),
      providerThreadId: null,
      childThreadId: null,
      nativeTaskRef: null,
      prompt: `Do ${id}`,
      title,
      model: "claude-haiku",
      status: "running",
      result: null,
      startedAt: DateTime.makeUnsafe(`2026-10-05T10:00:0${id.length}Z`),
      completedAt: null,
      updatedAt: DateTime.makeUnsafe("2026-10-05T10:00:00Z"),
    }) as unknown as OrchestrationV2Subagent;
  const subagents = [subagent("a", "Explore auth"), subagent("bb", "Explore auth")];
  const probe: { menu?: ReturnType<typeof useComposerCommandMenu> } = {};
  const onChangeDraftMessage = vi.fn();

  const capture = (menu: ReturnType<typeof useComposerCommandMenu>) => {
    probe.menu = menu;
  };

  function Probe({ draftMessage }: { draftMessage: string }) {
    const menu = useComposerCommandMenu({
      draftMessage,
      ownerKey: "owner",
      environmentId,
      currentThreadId: threadId,
      threadSubagents: subagents,
      projectCwd: null,
      selectedProviderStatus: null,
      hasThread: true,
      hasCompactableConversation: false,
      onChangeDraftMessage,
    });
    capture(menu);
    return null;
  }

  beforeEach(() => {
    vi.mocked(getComposerDraftSnapshot).mockReturnValue({ text: "", attachments: [] });
    vi.mocked(setComposerDraftContext).mockReset();
    onChangeDraftMessage.mockReset();
    const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
    const container = {
      nodeType: 1,
      tagName: "DIV",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      ownerDocument: document,
      addEventListener() {},
      removeEventListener() {},
    };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(container as unknown as HTMLElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it("opens on Files unless the query starts a handle", async () => {
    await act(async () => {
      root.render(createElement(Probe, { draftMessage: "see @src" }));
    });
    expect(probe.menu!.pathTab?.active).toBe("files");
    await act(async () => {
      probe.menu!.pathTab?.onChange("agents");
    });
    expect(probe.menu!.pathTab?.active).toBe("agents");
    expect(probe.menu!.items).toEqual([]);

    await act(async () => {
      root.render(createElement(Probe, { draftMessage: "@explore" }));
    });
    expect(probe.menu!.pathTab?.active).toBe("agents");
    expect(probe.menu!.items.map((item) => item.label)).toEqual([
      "@explore-auth",
      "@explore-auth-2",
    ]);
  });

  it("inserts the picked agent as a chip", async () => {
    await act(async () => {
      root.render(createElement(Probe, { draftMessage: "ask @explore-auth-2" }));
    });
    const item = probe.menu!.items[0]!;
    await act(async () => {
      probe.menu!.onSelect(item);
    });
    const record = vi.mocked(setComposerDraftContext).mock.calls[0]?.[1]?.records[0];
    expect(record).toMatchObject({
      kind: "subagent",
      handle: "explore-auth-2",
      subagentId: "bb",
      ownerThreadId: threadId,
      status: "running",
    });
    expect(onChangeDraftMessage).toHaveBeenCalledWith(expect.stringMatching(/^ask \S+ $/));
  });
});
