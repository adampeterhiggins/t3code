import { describe, expect, it } from "vite-plus/test";

import { attachmentQuickLook } from "./AttachmentQuickLook.logic";

describe("attachmentQuickLook", () => {
  it("renders Markdown files as Markdown", () => {
    expect(
      attachmentQuickLook({ name: "README.md", mimeType: "" }, "# Title\n\nBody", true),
    ).toEqual({ kind: "markdown", text: "# Title\n\nBody" });
  });

  it("shows CSV as a bounded table", () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      Array.from({ length: 10 }, (_, column) => `r${index}c${column}`).join(","),
    ).join("\n");
    const look = attachmentQuickLook({ name: "data.csv", mimeType: "text/csv" }, rows, true);
    expect(look?.kind).toBe("table");
    if (look?.kind !== "table") return;
    expect(look.rows).toHaveLength(8);
    expect(look.rows[0]).toHaveLength(6);
    expect(look.rows[1]?.[0]).toBe("r1c0");
  });

  it("highlights source in the file's language and keeps its opening lines", () => {
    const source = Array.from({ length: 30 }, (_, index) => `const v${index} = ${index};`).join(
      "\r\n",
    );
    const look = attachmentQuickLook({ name: "values.ts", mimeType: "" }, source, true);
    expect(look?.kind).toBe("code");
    if (look?.kind !== "code") return;
    expect(look.language).toBe("typescript");
    expect(look.text.split("\n")).toHaveLength(16);
    expect(look.text.startsWith("const v0 = 0;\nconst v1 = 1;")).toBe(true);
  });

  it("indents a whole minified JSON document", () => {
    const look = attachmentQuickLook(
      { name: "config.json", mimeType: "application/json" },
      '{"a":1,"b":[true]}',
      true,
    );
    expect(look).toEqual({
      kind: "code",
      language: "json",
      text: '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}',
    });
  });

  it("drops the cut-off last line of a partial read", () => {
    const look = attachmentQuickLook({ name: "notes.txt", mimeType: "" }, "one\ntwo\nthr", false);
    expect(look).toMatchObject({ kind: "code", text: "one\ntwo" });
  });

  it("has nothing to show for an empty file", () => {
    expect(attachmentQuickLook({ name: "empty.ts", mimeType: "" }, " \n\n", true)).toBeNull();
  });
});
