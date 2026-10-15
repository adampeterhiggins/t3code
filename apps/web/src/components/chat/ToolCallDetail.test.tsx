// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { projectedWorkEntry } from "../../session-logic";
import { ToolCallDetails } from "./ToolCallDetail";

vi.mock("../../state/queries", () => ({
  useTurnItemDetail: () => ({ data: undefined, isPending: false, error: null }),
}));
vi.mock("../../state/v2ItemSupport", () => ({ useV2ItemSupport: () => ({}) }));
vi.mock("./ShellCommandBlock", () => ({
  ShellCommandBlock: ({ command }: { command: string }) => <code>{command}</code>,
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const threadId = ThreadId.make("child");
const at = DateTime.makeUnsafe("2026-10-14T18:00:00Z");
const entry = projectedWorkEntry({
  position: 0,
  visibility: "local",
  sourceThreadId: threadId,
  sourceItemId: TurnItemId.make("cmd"),
  item: {
    id: TurnItemId.make("cmd"),
    threadId,
    ordinal: 0,
    type: "command_execution",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    status: "failed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    output: "Stored command output",
    input: "git status",
    exitCode: 1,
  },
});
const context = {
  activeThreadEnvironmentId: EnvironmentId.make("test"),
  markdownCwd: undefined,
  workspaceRoot: undefined,
  timestampFormat: "24-hour" as const,
  onOpenThread: vi.fn(),
  onOpenTurnDiff: vi.fn(),
};

describe("shared tool details", () => {
  it("shows command and failed exit immediately but mounts output only when requested", () => {
    act(() =>
      root.render(
        <ToolCallDetails
          {...context}
          workEntry={entry}
          previewText="git status"
          icon={null}
          preview
        />,
      ),
    );
    expect(host.textContent).toContain("git status");
    expect(host.textContent).toContain("failed");
    expect(host.textContent).toContain("exit 1");
    expect(host.textContent).not.toContain("Stored command output");
    const details = host.querySelector("details")!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(host.textContent).toContain("Stored command output");
  });

  it("opens the same stored output directly in an expanded call", () => {
    act(() =>
      root.render(
        <ToolCallDetails {...context} workEntry={entry} previewText="git status" icon={null} />,
      ),
    );
    expect(host.textContent).toContain("Stored command output");
    expect(host.querySelector("details")).toBeNull();
  });
  it("renders rich tool results with a working raw-call disclosure", () => {
    const item = entry.projectedItem?.item;
    if (item?.type !== "command_execution") throw new Error("Expected command fixture");
    const toolEntry = projectedWorkEntry({
      ...entry.projectedItem!,
      item: {
        ...item,
        type: "dynamic_tool",
        status: "completed",
        toolName: "ToolSearch",
        input: { query: "select:Monitor" },
        output: { matches: ["Monitor", "mcp__t3-code__preview_open"] },
      },
    });
    act(() =>
      root.render(
        <ToolCallDetails
          {...context}
          workEntry={toolEntry}
          previewText="ToolSearch"
          icon={null}
          preview
        />,
      ),
    );
    expect(host.textContent).toContain("Monitor");
    expect(host.textContent).toContain("preview_open");
    expect(host.textContent).not.toContain("select:Monitor");
    const raw = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Show raw call",
    )!;
    act(() => raw.click());
    expect(host.textContent).toContain("select:Monitor");
    expect(host.textContent).toContain("Hide raw call");
  });
});
