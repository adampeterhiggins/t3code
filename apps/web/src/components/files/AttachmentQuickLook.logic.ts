import { getFiletypeFromFileName } from "@pierre/diffs";
import { filePreviewDelimiter, parseDelimitedPreview } from "@t3tools/shared/delimitedPreview";
import { filePreviewKind } from "@t3tools/shared/filePreview";

/** Bytes read from a local attachment for its chip's hover preview. */
export const QUICK_LOOK_BYTES = 8192;
const CODE_LINES = 16;
const MARKDOWN_LINES = 40;
const TABLE_ROWS = 8;
const TABLE_COLUMNS = 6;

export type AttachmentQuickLook =
  | { readonly kind: "code"; readonly text: string; readonly language: string }
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "table"; readonly rows: readonly (readonly string[])[] };

/**
 * What a text attachment's hover card shows, from the opening bytes of the file: rendered
 * Markdown, a small table for CSV and TSV, or highlighted source in the file's language.
 * `complete` says the text is the whole file; a partial last line is dropped otherwise.
 * Null when there is nothing to show, so the card keeps just the name and size.
 */
export function attachmentQuickLook(
  file: { readonly name: string; readonly mimeType: string },
  text: string,
  complete: boolean,
): AttachmentQuickLook | null {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lastNewline = normalized.lastIndexOf("\n");
  const whole = complete || lastNewline < 0 ? normalized : normalized.slice(0, lastNewline);
  if (whole.trim() === "") return null;

  const kind = filePreviewKind(file);
  if (kind === "markdown") {
    return { kind: "markdown", text: firstLines(whole, MARKDOWN_LINES) };
  }
  const delimiter = filePreviewDelimiter(file);
  if (delimiter) {
    const rows = parseDelimitedPreview(whole, delimiter)
      .rows.slice(0, TABLE_ROWS)
      .map((row) => row.slice(0, TABLE_COLUMNS));
    if (rows.length > 0) return { kind: "table", rows };
  }
  const language = getFiletypeFromFileName(file.name);
  return {
    kind: "code",
    text: firstLines(language === "json" && complete ? prettyJson(whole) : whole, CODE_LINES),
    language,
  };
}

function firstLines(text: string, count: number): string {
  return text.split("\n").slice(0, count).join("\n").trimEnd();
}

/** Minified JSON reads as one long line; a whole, valid document is shown indented. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
