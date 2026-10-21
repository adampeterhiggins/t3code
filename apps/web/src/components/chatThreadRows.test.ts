import type { ChatThreadMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chatThreadRows } from "./chatThreadRows";

const message = (index: number): ChatThreadMessage => ({
  index,
  authorName: `Author ${index}`,
  avatarUrl: null,
  postedAt: "2026-10-21T14:54:00.000Z",
  text: "text",
  files: [],
  linked: false,
});

const shape = (rows: ReturnType<typeof chatThreadRows>) =>
  rows.map((row) => (row.type === "message" ? row.message.index : `${row.type}:${row.count}`));

describe("chatThreadRows", () => {
  it("puts the reply rule under the parent", () => {
    expect(shape(chatThreadRows([message(0), message(1), message(2)], 2))).toEqual([
      0,
      "replies:2",
      1,
      2,
    ]);
  });

  it("shows a lone message without a rule", () => {
    expect(shape(chatThreadRows([message(0)], 0))).toEqual([0]);
  });

  it("marks the messages the server left out, including after the last one kept", () => {
    expect(shape(chatThreadRows([message(0), message(3), message(8)], 10))).toEqual([
      0,
      "replies:10",
      "omitted:2",
      3,
      "omitted:4",
      8,
      "omitted:2",
    ]);
  });
});
