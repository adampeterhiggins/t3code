import { describe, expect, it } from "vite-plus/test";

describe("GitHub issue chip status", () => {
  it("colours an issue green while open and purple once closed, keeping one glyph", async () => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    const open = contextChipPresentation("github-issue", { kind: "github-issue", state: "open" });
    const closed = contextChipPresentation("github-issue", {
      kind: "github-issue",
      state: "closed",
    });
    expect(open.accent).toBe("#009f6e");
    expect(closed.accent).toBe("#8a70dd");
    expect(closed.icon).toBe(open.icon);
  });
});

describe("fork context chip assets", () => {
  it.each([
    ["linear-issue", "ticket"],
    ["slack-thread", "hash"],
    ["discord-thread", "messages-square"],
    ["repository", "folder-git-2"],
    ["checkout", "laptop"],
    ["unread-link", "link"],
  ])("keeps %s distinguishable with a shared native icon", async (kind, icon) => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    expect(contextChipPresentation(kind).icon).toBe(icon);
  });

  it.each([
    ["release", "tag"],
    ["tag", "tag"],
    ["branch", "git-branch"],
    ["commit", "git-commit-horizontal"],
  ])("renders a GitHub %s with its own glyph", async (refType, icon) => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    expect(contextChipPresentation("github-ref", { refType }).icon).toBe(icon);
  });
});
