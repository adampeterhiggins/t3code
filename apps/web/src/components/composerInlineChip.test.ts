import { describe, expect, it } from "vite-plus/test";

import { attachmentTextExcerpt, middleTruncateAttachmentName } from "./composerInlineChip";

describe("middleTruncateAttachmentName", () => {
  it("leaves short names unchanged", () => {
    expect(middleTruncateAttachmentName("notes.txt")).toBe("notes.txt");
  });

  it("keeps the start and filename extension", () => {
    const result = middleTruncateAttachmentName(
      "a-very-long-customer-reproduction-screenshot.final.png",
    );
    expect(result).toHaveLength(36);
    expect(result).toMatch(/^a-very-long-customer/);
    expect(result).toMatch(/final\.png$/);
    expect(result).toContain("…");
  });

  it("truncates Unicode names without splitting a character", () => {
    expect(middleTruncateAttachmentName("😀😀😀😀😀😀.png", 8)).toBe("😀😀😀….png");
  });

  it("honours very small limits", () => {
    expect(middleTruncateAttachmentName("notes.txt", 0)).toBe("");
    expect(middleTruncateAttachmentName("notes.txt", 1)).toBe("…");
    expect(middleTruncateAttachmentName("notes.txt", 2)).toBe("n…");
  });

  it("keeps useful ends for multi-dot names and names without extensions", () => {
    expect(middleTruncateAttachmentName("customer.export.final.very-long-name.json", 24)).toMatch(
      /long-name\.json$/,
    );
    expect(middleTruncateAttachmentName("a-very-long-filename-without-an-extension", 20)).toMatch(
      /^a-ver.*extension$/,
    );
  });
});

describe("attachmentTextExcerpt", () => {
  it("keeps the opening lines and normalizes line endings", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\r\n");
    const excerpt = attachmentTextExcerpt(text);
    expect(excerpt?.split("\n")).toHaveLength(12);
    expect(excerpt).toMatch(/^line 1\nline 2\n/);
    expect(excerpt).toMatch(/line 12$/);
  });

  it("has nothing to show for binary or blank content", () => {
    expect(attachmentTextExcerpt("PK\u0003\u0004\u0000\u0000")).toBeNull();
    expect(attachmentTextExcerpt(" \n\n\t")).toBeNull();
  });
});
