import type { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { linearAppUrl, threadsForLinearIssue } from "./linear.ts";

describe("linearAppUrl", () => {
  it("moves a linear.app link onto the Linear app's scheme", () => {
    expect(linearAppUrl("https://linear.app/acme/issue/ENG-1/fix-login")).toBe(
      "linear://acme/issue/ENG-1/fix-login",
    );
    expect(linearAppUrl("https://linear.app/acme/issue/ENG-1#comment-2")).toBe(
      "linear://acme/issue/ENG-1#comment-2",
    );
  });

  it("leaves other links alone", () => {
    for (const url of ["https://example.com/acme/issue/ENG-1", "http://linear.app/a", "nope"]) {
      expect(linearAppUrl(url), url).toBeNull();
    }
  });
});

describe("threadsForLinearIssue", () => {
  const link = {
    groupId: "a" as ThreadId,
    threadIds: ["a", "b"] as ThreadId[],
    issueId: "uuid-1",
    identifier: "ENG-1",
    title: "Issue",
    url: "https://linear.app/acme/issue/ENG-1",
    linkedAt: "2026-09-30T00:00:00.000Z",
  };
  const thread = (id: string, updatedAt: string, archivedAt: string | null = null) => ({
    id: id as ThreadId,
    updatedAt,
    archivedAt,
  });

  it("finds a linked group's live threads, newest first", () => {
    const threads = [
      thread("a", "2026-09-01T00:00:00.000Z"),
      thread("b", "2026-09-02T00:00:00.000Z"),
      thread("c", "2026-09-03T00:00:00.000Z"),
    ];
    expect(threadsForLinearIssue(threads, [link], "uuid-1").map((t) => t.id)).toEqual(["b", "a"]);
    expect(threadsForLinearIssue(threads, [link], "uuid-2")).toEqual([]);
  });

  it("skips archived threads", () => {
    const threads = [thread("a", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z")];
    expect(threadsForLinearIssue(threads, [link], "uuid-1")).toEqual([]);
  });
});
