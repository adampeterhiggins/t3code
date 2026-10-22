import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { projectedWorkEntry } from "../../session-logic";
import { render } from "../../../test/render";

vi.mock(import("../../state/queries"), async (importOriginal) => ({
  ...(await importOriginal()),
  useTurnItemDetail: () => ({ data: undefined, isPending: false, error: null }) as never,
}));
vi.mock(import("../../state/v2ItemSupport"), async (importOriginal) => ({
  ...(await importOriginal()),
  useV2ItemSupport: () => ({}) as never,
}));
vi.mock("./ShellCommandBlock", () => ({
  ShellCommandBlock: ({ command }: { command: string }) => <code>{command}</code>,
}));

import { ToolCallDetails } from "./ToolCallDetail";

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
  it("shows command and failed exit immediately but mounts output only when requested", async () => {
    await using screen = await render(
      <ToolCallDetails
        {...context}
        workEntry={entry}
        previewText="git status"
        icon={null}
        preview
      />,
    );
    const host = screen.container;
    expect(host.textContent).toContain("git status");
    expect(host.textContent).toContain("failed");
    expect(host.textContent).toContain("exit 1");
    expect(host.textContent).not.toContain("Stored command output");
    await userEvent.click(host.querySelector("summary")!);
    await expect.element(screen.getByText("Stored command output")).toBeInTheDocument();
  });

  it("opens the same stored output directly in an expanded call", async () => {
    await using screen = await render(
      <ToolCallDetails {...context} workEntry={entry} previewText="git status" icon={null} />,
    );
    expect(screen.container.textContent).toContain("Stored command output");
    expect(screen.container.querySelector("details")).toBeNull();
  });

  it("renders rich tool results with the call's time beside a working Raw call", async () => {
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
    await using screen = await render(
      <ToolCallDetails
        {...context}
        workEntry={toolEntry}
        previewText="ToolSearch"
        icon={null}
        preview
      />,
    );
    const host = screen.container;
    expect(host.textContent).toContain("Monitor");
    expect(host.textContent).toContain("preview_open");
    expect(host.textContent).not.toContain("select:Monitor");
    // The time and state sit in the card's footer, once, beside Raw call.
    const footer = screen.getByRole("button", { name: "Raw call" }).element().parentElement!;
    expect(footer.textContent).toContain("completed");
    expect(host.textContent!.split("completed")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Raw call" }));
    await expect.element(screen.getByRole("button", { name: "Hide raw call" })).toBeInTheDocument();
    expect(host.textContent).toContain("select:Monitor");
  });
});
