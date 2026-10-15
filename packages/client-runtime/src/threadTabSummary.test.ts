import { describe, expect, it } from "vite-plus/test";

import { parseThreadTabSummary, threadTabSummaryTools } from "./threadTabSummary.ts";

describe("parseThreadTabSummary", () => {
  it("reads each source chat's header, plan, and turns", () => {
    const summary = [
      "Source thread: thread-1 (snapshot 12)\nRelated chat: Fix login redirect",
      "Latest turn: running",
      "Files changed:\n- apps/web/src/login.ts (+3 −1)\n- …and 2 more",
      "Latest plan:\n1. Find the redirect\n\n2. Fix it",
      "User: The login page loops\n\nafter sign in\nReasoning (excerpt): Check the guard\nTools: Command: vp test · Edit: login.ts (failed)\nAssistant: Fixed it",
      "[3 turns omitted]",
      "User: Add a test\nError: transport failure",
      "Source thread: thread-2 (snapshot 4)\nRelated chat: New tab",
    ].join("\n\n");
    expect(parseThreadTabSummary(summary)).toEqual([
      {
        title: "Fix login redirect",
        latestTurn: "running",
        files: ["apps/web/src/login.ts (+3 −1)"],
        moreFiles: 2,
        plan: "1. Find the redirect\n\n2. Fix it",
        blocks: [
          { kind: "entry", role: "user", text: "The login page loops\n\nafter sign in" },
          { kind: "entry", role: "reasoning", text: "Check the guard" },
          { kind: "entry", role: "tools", text: "Command: vp test · Edit: login.ts (failed)" },
          { kind: "entry", role: "assistant", text: "Fixed it" },
          { kind: "omitted", turns: 3 },
          { kind: "entry", role: "user", text: "Add a test" },
          { kind: "entry", role: "error", text: "transport failure" },
        ],
      },
      {
        title: "New tab",
        latestTurn: null,
        files: [],
        moreFiles: 0,
        plan: null,
        blocks: [],
      },
    ]);
  });

  it("leaves text in another shape to be shown as written", () => {
    expect(parseThreadTabSummary("Subagent findings:\nUser: not a summary")).toBeNull();
  });

  it("splits a tools entry into calls and marks failures", () => {
    expect(threadTabSummaryTools("Command: git status (failed) · Read: a.ts · +2 more")).toEqual([
      { label: "Command: git status", failed: true },
      { label: "Read: a.ts", failed: false },
      { label: "+2 more", failed: false },
    ]);
  });
});
