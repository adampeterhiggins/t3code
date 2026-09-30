import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createThreadAttachSummaryLoader,
  parseThreadSummaryPreview,
} from "./threadAttachPickerSummary";

const threadId = ThreadId.make("source-thread");

describe("thread attachment summary snapshots", () => {
  it("shares an in-flight request between preview and attachment and retains the previewed snapshot", async () => {
    let resolveSummary = (_summary: string) => {};
    const fetchSummary = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSummary = resolve;
        }),
    );
    const load = createThreadAttachSummaryLoader(fetchSummary);
    const preview = load(threadId);
    const attachment = load(threadId);
    expect(attachment).toBe(preview);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    resolveSummary("The previewed conversation");
    expect(await attachment).toBe("The previewed conversation");
    expect(load(threadId)).toBe(preview);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });

  it("allows a failed preview to be retried when selecting or hovering again", async () => {
    const fetchSummary = vi
      .fn<(id: ThreadId) => Promise<string>>()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce("Restored conversation");
    const load = createThreadAttachSummaryLoader(fetchSummary);
    await expect(load(threadId)).rejects.toThrow("Disconnected");
    await expect(load(threadId)).resolves.toBe("Restored conversation");
    expect(fetchSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps different threads' snapshots separate", async () => {
    const fetchSummary = vi.fn(async (id: ThreadId) => `Summary of ${id}`);
    const load = createThreadAttachSummaryLoader(fetchSummary);
    const otherThreadId = ThreadId.make("other-thread");
    expect(await load(threadId)).toBe("Summary of source-thread");
    expect(await load(otherThreadId)).toBe("Summary of other-thread");
    expect(fetchSummary).toHaveBeenCalledTimes(2);
  });
});

describe("parseThreadSummaryPreview", () => {
  it("pulls the opening request, latest exchange, and changed files from a handoff", () => {
    const summary = [
      "Related chat: Fix login redirect",
      "Latest turn: completed",
      "Files changed:\n- apps/web/src/login.ts\n- apps/web/src/auth.ts\n- …and 3 more",
      "Latest plan:\n1. Find the redirect",
      "User: The login page loops\nafter sign in\nAssistant: Looking into it\nTools: Read login.ts",
      "[2 turns omitted]",
      "User: Add a test too\nReasoning (excerpt): thinking\nAssistant: Added a regression test\nwith two cases",
    ].join("\n\n");
    expect(parseThreadSummaryPreview(summary)).toEqual({
      latestTurnState: "completed",
      files: ["apps/web/src/login.ts", "apps/web/src/auth.ts"],
      moreFiles: 3,
      opening: "The login page loops\nafter sign in",
      latestUser: "Add a test too",
      latestAssistant: "Added a regression test\nwith two cases",
      earlierTurns: 2,
    });
  });

  it("shows a single-turn chat's reply without repeating the request", () => {
    const preview = parseThreadSummaryPreview(
      "Related chat: Quick question\n\nUser: What is T3?\nAssistant: A GUI for agents",
    );
    expect(preview).toMatchObject({
      opening: "What is T3?",
      latestUser: null,
      latestAssistant: "A GUI for agents",
      earlierTurns: 0,
    });
  });

  it("reads a chat with no messages yet as having no dialogue", () => {
    expect(parseThreadSummaryPreview("Related chat: New tab")).toEqual({
      latestTurnState: null,
      files: [],
      moreFiles: 0,
      opening: null,
      latestUser: null,
      latestAssistant: null,
      earlierTurns: 0,
    });
  });
});
