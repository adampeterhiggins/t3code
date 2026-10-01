import { describe, expect, it } from "vite-plus/test";

import { defaultComposerReferenceTab } from "./useComposerLinearIssueItems";

describe("defaultComposerReferenceTab", () => {
  it("opens Linear issues for an issue identifier", () => {
    expect(defaultComposerReferenceTab("ENG-123", true)).toBe("linear-issues");
  });

  it("opens repositories for an owner-qualified name", () => {
    expect(defaultComposerReferenceTab("adampeterhiggins/setgist", false)).toBe("repositories");
    expect(defaultComposerReferenceTab("focaldata/", false)).toBe("repositories");
  });

  it("opens repositories for a hyphenated name only once a default owner is set", () => {
    expect(defaultComposerReferenceTab("cin-questionnaire", true)).toBe("repositories");
    expect(defaultComposerReferenceTab("cin-questionnaire", false)).toBe("pull-requests");
  });

  it("keeps numbers and plain words on pull requests", () => {
    expect(defaultComposerReferenceTab("", true)).toBe("pull-requests");
    expect(defaultComposerReferenceTab("123", true)).toBe("pull-requests");
    expect(defaultComposerReferenceTab("composer", true)).toBe("pull-requests");
  });
});
