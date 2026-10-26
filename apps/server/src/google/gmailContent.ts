import * as Schema from "effect/Schema";
import { GOOGLE_FILE_MARKDOWN_MAX_CHARS } from "@t3tools/contracts";

interface MailPart {
  readonly mimeType?: string;
  readonly filename?: string;
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly body?: { readonly data?: string; readonly attachmentId?: string };
  readonly parts?: ReadonlyArray<MailPart>;
}
const MailPart: Schema.Codec<MailPart> = Schema.Struct({
  mimeType: Schema.optionalKey(Schema.String),
  filename: Schema.optionalKey(Schema.String),
  headers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  ),
  body: Schema.optionalKey(
    Schema.Struct({
      data: Schema.optionalKey(Schema.String),
      attachmentId: Schema.optionalKey(Schema.String),
    }),
  ),
  parts: Schema.optionalKey(Schema.Array(Schema.suspend(() => MailPart))),
});
export const GmailMessage = Schema.Struct({
  id: Schema.String,
  internalDate: Schema.String,
  snippet: Schema.optionalKey(Schema.String),
  labelIds: Schema.optionalKey(Schema.Array(Schema.String)),
  payload: Schema.optionalKey(MailPart),
});
export const GmailThread = Schema.Struct({
  id: Schema.String,
  historyId: Schema.String,
  messages: Schema.optionalKey(Schema.Array(GmailMessage)),
});

/** Prefer plain text in multipart alternatives; attachments stay in Gmail. */
export function gmailBody(part: MailPart | undefined, depth = 0): string {
  if (!part || depth > 20) return "";
  if (part.filename) return `[Attachment: ${part.filename}]`;
  if (part.parts?.length) {
    const parts =
      part.mimeType === "multipart/alternative"
        ? [
            part.parts.find((p) => p.mimeType === "text/plain") ??
              part.parts.find((p) => p.mimeType === "text/html") ??
              part.parts[0],
          ]
        : part.parts;
    return parts
      .map((p) => gmailBody(p, depth + 1))
      .join("\n\n")
      .slice(0, GOOGLE_FILE_MARKDOWN_MAX_CHARS + 1);
  }
  if (!part.body?.data || !["text/plain", "text/html"].includes(part.mimeType ?? "")) return "";
  try {
    const text = Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .slice(0, GOOGLE_FILE_MARKDOWN_MAX_CHARS + 1);
    // HTML stays source text, never executable markup in a client preview.
    if (part.mimeType !== "text/html") return text;
    const fence = "`".repeat(
      Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)),
    );
    return `HTML email source:\n\n${fence}html\n${text}\n${fence}`;
  } catch {
    return "[Unreadable email body.]";
  }
}
