import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ComposerStartFromSelection, DesktopQuickMessageStartFrom } from "./composerStartFrom.ts";

describe("ComposerStartFromSelection", () => {
  const decode = Schema.decodeUnknownSync(ComposerStartFromSelection);

  it("keeps the previous quick-message name as the same schema", () => {
    expect(DesktopQuickMessageStartFrom).toBe(ComposerStartFromSelection);
  });

  it("decodes each start-from pick", () => {
    expect(
      decode({
        type: "branch",
        branch: "main",
        worktreePath: null,
        envMode: "local",
      }),
    ).toEqual({
      type: "branch",
      branch: "main",
      worktreePath: null,
      envMode: "local",
    });
    expect(
      decode({
        type: "pull-request",
        url: "https://github.com/t3tools/t3code/pull/1",
        number: 1,
        title: "Fix the flaky test",
      }).type,
    ).toBe("pull-request");
    expect(
      decode({
        type: "github-issue",
        url: "https://github.com/t3tools/t3code/issues/2",
        number: 2,
        title: "Window identity",
      }).type,
    ).toBe("github-issue");
    expect(
      decode({
        type: "linear-issue",
        issueId: "issue-1",
        identifier: "T3-1",
        title: "Detached composer",
      }).type,
    ).toBe("linear-issue");
  });
});
