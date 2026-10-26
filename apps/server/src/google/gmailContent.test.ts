import { describe, expect, it } from "vite-plus/test";
import { GOOGLE_FILE_MARKDOWN_MAX_CHARS } from "@t3tools/contracts";
import { gmailBody } from "./gmailContent.ts";

const body = (text: string) => ({ data: Buffer.from(text).toString("base64url") });
describe("Gmail message bodies", () => {
  it("prefers UTF-8 plain text without duplicating HTML alternatives", () => {
    expect(
      gmailBody({
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/html", body: body("<b>Hello</b>") },
          { mimeType: "text/plain", body: body("Hello £18 👋") },
        ],
      }),
    ).toBe("Hello £18 👋");
  });
  it("keeps HTML-only source and attachment names without reading attachment data", () => {
    expect(
      gmailBody({
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "text/html", body: body("<b>Hello</b>") },
          { filename: "quote.pdf", mimeType: "application/pdf", body: { attachmentId: "a1" } },
        ],
      }),
    ).toBe("HTML email source:\n\n```html\n<b>Hello</b>\n```\n\n[Attachment: quote.pdf]");
  });
  it("bounds oversized text and stops deeply nested MIME parts", () => {
    expect(gmailBody({ mimeType: "text/plain", body: body("x".repeat(100_000)) }).length).toBe(
      GOOGLE_FILE_MARKDOWN_MAX_CHARS + 1,
    );
    expect(gmailBody({ mimeType: "text/plain", body: body("hidden") }, 21)).toBe("");
  });
});
