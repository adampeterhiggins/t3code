export const SKILL_CHIP_ICON_SVG = `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;

/** Keeps both the recognizable beginning and the extension/end of a long attachment name. */
export function middleTruncateAttachmentName(name: string, maxCharacters = 36): string {
  const characters = Array.from(name);
  if (characters.length <= maxCharacters) return name;
  if (maxCharacters <= 0) return "";
  if (maxCharacters === 1) return "…";
  const available = maxCharacters - 1;
  const suffixLength = Math.min(available - 1, available >= 18 ? 14 : Math.ceil(available / 2));
  const prefixLength = available - suffixLength;
  const suffix = suffixLength === 0 ? "" : characters.slice(-suffixLength).join("");
  return `${characters.slice(0, prefixLength).join("")}…${suffix}`;
}

/** Bytes read from a local text attachment for its chip's hover excerpt. */
export const ATTACHMENT_EXCERPT_BYTES = 4096;
const ATTACHMENT_EXCERPT_LINES = 12;

/**
 * The opening lines of a text attachment, for a chip's hover card. Null when the bytes look
 * binary or hold nothing to show, so the card falls back to the name and size.
 */
export function attachmentTextExcerpt(text: string): string | null {
  if (text.includes("\u0000")) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(0, ATTACHMENT_EXCERPT_LINES);
  const excerpt = lines.join("\n").trimEnd();
  return excerpt.trim() === "" ? null : excerpt;
}
