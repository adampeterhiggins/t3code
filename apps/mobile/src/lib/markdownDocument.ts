import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { objectLinkLabel } from "@t3tools/shared/composerObjectLinks";
import { pictureSourceUrl, type PictureSource } from "@t3tools/shared/markdownPipeline";
import {
  GITHUB_ISSUE_REFERENCE,
  githubIssueReferenceUrl,
  mayHaveGitHubIssueReference,
} from "@t3tools/shared/githubIssueReferences";
import {
  type LinearIssueReferences,
  linearIssueReferenceUrl,
} from "@t3tools/shared/linearIssueReferences";

const parser = unified().use(remarkParse).use(remarkGfm);
export type MarkdownNode = Root | RootContent;

function decodeCodePoint(codePoint: number, entity: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) {
        return decodeCodePoint(Number.parseInt(decimal, 10), entity);
      }
      if (hexadecimal) {
        return decodeCodePoint(Number.parseInt(hexadecimal, 16), entity);
      }
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&apos;":
          return "'";
        case "&gt;":
          return ">";
        case "&lt;":
          return "<";
        case "&nbsp;":
          return "\u00a0";
        case "&quot;":
          return '"';
        default:
          return entity;
      }
    },
  );
}

const HTML_TAG = /<!--[\s\S]*?-->|<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function attribute(tag: string, name: string): string | null {
  const attributes = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(attributes)) {
    if (match[1]?.toLowerCase() === name) {
      return decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return null;
}

function markdownDestination(url: string): string {
  return `<${url.replace(/&/g, "\\&").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\|/g, "%7C").replace(/\n/g, "")}>`;
}

const ANCHOR_TAG = /^<\/?a[\s/>]/i;

/** Replacements for the anchor tags still ahead, and how many emitted links are open. */
type AnchorState = { readonly pending: string[]; open: number };

// Code spans keep their text; an odd trailing backslash would escape the closing "]".
function escapeLinkLabel(text: string): string {
  return text
    .replace(/(`+)[\s\S]*?\1|\\*[[\]]/g, (match) =>
      match.startsWith("`") || match.length % 2 === 0
        ? match
        : `${match.slice(0, -1)}\\${match.slice(-1)}`,
    )
    .replace(/\\+$/, (slashes) => (slashes.length % 2 ? `${slashes}\\` : slashes));
}

// An unescaped "!" before the inserted "[" would turn the link into an image.
function bangBefore(text: string, index: number): boolean {
  if (text[index - 1] !== "!") return false;
  let backslashes = 0;
  while (text[index - 2 - backslashes] === "\\") backslashes += 1;
  return backslashes % 2 === 0;
}

/**
 * Pairs `<a>` tags in order. Only a closed anchor with an http(s) or mailto href becomes a
 * Markdown link; any other anchor keeps its text unlinked.
 */
function anchorMarkdown(tags: readonly string[]): AnchorState {
  const replacements = tags.map(() => "");
  const open: Array<{ index: number; href: string | undefined }> = [];
  tags.forEach((tag, index) => {
    if (tag[1] !== "/") {
      const href = attribute(tag, "href")?.trim();
      open.push({ index, href: href && /^(?:https?|mailto):/i.test(href) ? href : undefined });
      return;
    }
    const opening = open.pop();
    if (!opening?.href) return;
    replacements[opening.index] = "[";
    replacements[index] = `](${markdownDestination(opening.href)})`;
  });
  return { pending: replacements, open: 0 };
}

function markdownHtmlTags(content: string): RegExpExecArray[] {
  // An HTML block such as <details> can also contain Markdown fences and code spans.
  const codeRanges: Array<{ start: number; end: number }> = [];
  const tags = [...content.matchAll(HTML_TAG)];
  let tagIndex = 0;
  const delimiters = [...content.matchAll(/`+|~{3,}/g)].filter((delimiter) => {
    while (tags[tagIndex] && tags[tagIndex]!.index + tags[tagIndex]![0].length <= delimiter.index)
      tagIndex += 1;
    const tag = tags[tagIndex];
    return !tag || delimiter.index < tag.index;
  });
  for (let index = 0; index < delimiters.length; index += 1) {
    const opening = delimiters[index]!;
    const lineStart = content.lastIndexOf("\n", opening.index - 1) + 1;
    const fenced =
      opening[0].length >= 3 && /^ {0,3}$/.test(content.slice(lineStart, opening.index));
    if (opening[0][0] === "~" && !fenced) continue;
    let closingIndex = -1;
    for (let candidate = index + 1; candidate < delimiters.length; candidate += 1) {
      const closing = delimiters[candidate]!;
      if (!fenced && closing[0] === opening[0]) {
        closingIndex = candidate;
        break;
      }
      if (!fenced || closing[0][0] !== opening[0][0] || closing[0].length < opening[0].length)
        continue;
      const start = content.lastIndexOf("\n", closing.index - 1) + 1;
      const nextLine = content.indexOf("\n", closing.index);
      const end = nextLine === -1 ? content.length : nextLine;
      if (
        /^ {0,3}$/.test(content.slice(start, closing.index)) &&
        /^\s*$/.test(content.slice(closing.index + closing[0].length, end))
      ) {
        closingIndex = candidate;
        break;
      }
    }
    if (closingIndex === -1) {
      if (fenced) codeRanges.push({ start: opening.index, end: content.length });
      continue;
    }
    const closing = delimiters[closingIndex]!;
    codeRanges.push({ start: opening.index, end: closing.index + closing[0].length });
    index = closingIndex;
  }
  return tags.filter(
    (tag) => !codeRanges.some((range) => tag.index >= range.start && tag.index < range.end),
  );
}

/**
 * Called only for parsed HTML nodes, so Markdown code examples keep their literal tags.
 * `anchors` is shared across sibling inline HTML nodes because each of those carries a single tag.
 */
export function markdownHtmlContent(
  content: string,
  optionsOrAppearance:
    | {
        readonly anchors?: AnchorState;
        readonly inTableCell?: boolean;
        readonly appearance?: "light" | "dark";
      }
    | "light"
    | "dark" = {},
): string {
  const options =
    typeof optionsOrAppearance === "string"
      ? { appearance: optionsOrAppearance }
      : optionsOrAppearance;
  const tags = markdownHtmlTags(content);
  const anchors =
    options.anchors ??
    anchorMarkdown(tags.map((tag) => tag[0]).filter((tag) => ANCHOR_TAG.test(tag)));
  let result = "";
  let end = 0;
  let inPicture = false;
  const sources: PictureSource[] = [];
  let pictureImage: { src: string; alt: string } | null = null;
  const renderedPicture = () => {
    const src = pictureSourceUrl(
      sources,
      pictureImage?.src || undefined,
      options.appearance ?? "light",
    );
    const alt = (pictureImage?.alt ?? "").replace(/[\\[\]&]/g, "\\$&");
    return src ? `![${alt}](${markdownDestination(src)})` : "";
  };
  for (const match of tags) {
    const text = content.slice(end, match.index);
    result += anchors.open > 0 ? escapeLinkLabel(text) : text;
    const tag = match[0];
    let replacement: string;
    if (/^<picture\b/i.test(tag)) {
      inPicture = true;
      sources.length = 0;
      pictureImage = null;
      replacement = "";
    } else if (inPicture && /^<source\b/i.test(tag)) {
      sources.push({
        media: attribute(tag, "media") ?? undefined,
        srcSet: attribute(tag, "srcset") ?? undefined,
      });
      replacement = "";
    } else if (inPicture && /^<img\b/i.test(tag)) {
      pictureImage = { src: attribute(tag, "src") ?? "", alt: attribute(tag, "alt") ?? "" };
      replacement = "";
    } else if (inPicture && /^<\/picture\s*>/i.test(tag)) {
      inPicture = false;
      replacement = renderedPicture();
    } else replacement = htmlTagMarkdown(tag, anchors, options);
    if (replacement === "[" && bangBefore(result, result.length))
      result = `${result.slice(0, -1)}\\!`;
    result +=
      anchors.open > 0 && /[\s[]/.test(result.at(-1) ?? "")
        ? replacement.replace(/^ /, "")
        : replacement;
    end = match.index + match[0].length;
  }
  const text = content.slice(end);
  return (
    result +
    (anchors.open > 0 ? escapeLinkLabel(text) : text) +
    (inPicture ? renderedPicture() : "")
  );
}

function htmlTagMarkdown(
  tag: string,
  anchors: AnchorState,
  options: { readonly inTableCell?: boolean },
): string {
  if (tag.startsWith("<!--")) return "";
  if (ANCHOR_TAG.test(tag)) {
    const replacement = anchors.pending.shift() ?? "";
    if (replacement === "[") anchors.open += 1;
    else if (replacement) anchors.open -= 1;
    return replacement;
  }
  if (/^<img\b/i.test(tag)) {
    const src = attribute(tag, "src");
    if (!src) return "";
    const alt = (attribute(tag, "alt") ?? "").replace(/[\\[\]&]/g, "\\$&");
    return `![${alt}](${markdownDestination(src)})`;
  }
  // A blank line inside an open link label would end the paragraph before its "]".
  const blockBreak = anchors.open === 0 ? "\n\n" : " ";
  if (/^<summary\b/i.test(tag)) return `${blockBreak}**`;
  if (/^<\/summary\s*>/i.test(tag)) return `**${blockBreak}`;
  // A line break would end the table row, so a cell keeps its content on one line.
  if (/^<br\b/i.test(tag)) return options.inTableCell ? " " : "  \n";
  if (/^<\/?(?:p|div|details)\b/i.test(tag)) return blockBreak;
  return "";
}

export function markdownWithHtml(markdown: string, appearance: "light" | "dark" = "light"): string {
  if (!/<(?:!--|\/?[a-z])/i.test(markdown)) return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode, inTableCell: boolean, inLink: boolean) => {
    if (!("children" in node)) return;
    inTableCell ||= node.type === "tableCell";
    const children: readonly MarkdownNode[] = node.children;
    // Inline HTML arrives one tag per node, so anchors pair across phrasing siblings.
    const anchors =
      node.type === "root" || node.type === "blockquote" || node.type === "listItem"
        ? undefined
        : anchorMarkdown(
            children.flatMap((child) =>
              child.type === "html"
                ? markdownHtmlTags(child.value)
                    .map((tag) => tag[0])
                    .filter((tag) => ANCHOR_TAG.test(tag))
                : [],
            ),
          );
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (child.type === "html" && /^<picture\b/i.test(child.value)) {
        let last = index;
        while (last + 1 < children.length) {
          const next = children[last + 1]!;
          if (next.type !== "html" && !(next.type === "text" && /^\s*$/.test(next.value))) break;
          last += 1;
          if (next.type === "html" && /<\/picture\s*>/i.test(next.value)) break;
        }
        const pictureStart = child.position?.start.offset;
        const pictureEnd = children[last]?.position?.end.offset;
        if (pictureStart !== undefined && pictureEnd !== undefined) {
          edits.push({
            start: pictureStart,
            end: pictureEnd,
            content: markdownHtmlContent(markdown.slice(pictureStart, pictureEnd), {
              anchors,
              inTableCell,
              appearance,
            }),
          });
          index = last;
          continue;
        }
      }
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      const linkLabel = inLink || (anchors?.open ?? 0) > 0;
      if (child.type === "text") {
        if (linkLabel && start !== undefined && end !== undefined) {
          const content = escapeLinkLabel(markdown.slice(start, end));
          if (content !== markdown.slice(start, end)) edits.push({ start, end, content });
        }
        continue;
      }
      if (child.type !== "html") {
        visit(child, inTableCell, linkLabel);
        continue;
      }
      const content = markdownHtmlContent(child.value, { anchors, inTableCell, appearance });
      if (start === undefined || end === undefined) continue;
      // Text before an outermost link is never edited, so this edit cannot overlap another.
      if (content.startsWith("[") && !linkLabel && bangBefore(markdown, start))
        edits.push({ start: start - 1, end: start, content: "\\!" });
      edits.push({ start, end, content });
    }
  };
  visit(parser.parse(markdown), false, false);
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}

const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]+/giu;

/**
 * Fork: a bare pull request, issue, Linear issue, or repository link reads as its short name
 * (`owner/repo#7`, `ENG-123`, `owner/repo`) instead of its URL. Link text the writer chose stays.
 * `urls` lists the renamed links, so copying one can still give its full URL.
 */
export function markdownWithObjectLinkLabels(markdown: string): {
  readonly markdown: string;
  readonly urls: ReadonlyArray<string>;
} {
  // Most messages carry no such link; skip the parse for them.
  if (!Array.from(markdown.matchAll(BARE_URL), (match) => match[0]).some(isObjectLinkCandidate))
    return { markdown, urls: [] };
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const urls = new Set<string>();
  const visit = (node: MarkdownNode) => {
    if (node.type === "link") {
      const child = node.children.length === 1 ? node.children[0] : undefined;
      const label =
        child?.type === "text" && child.value === node.url ? objectLinkLabel(node.url) : null;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (label !== null && start !== undefined && end !== undefined) {
        const text = label.replace(/[\\[\]]/g, "\\$&");
        const href = node.url.replace(/</g, "%3C").replace(/>/g, "%3E");
        edits.push({ start, end, content: `[${text}](<${href}>)` });
        urls.add(node.url);
      }
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return { markdown, urls: [...urls] };
}

/**
 * Fork: a bare Linear issue identifier (`ENG-123`) links to the workspace, as on the web, so it
 * reads as the issue's link pill. Code and existing links keep their text.
 */
export function markdownWithLinearIssueLinks(
  markdown: string,
  references: LinearIssueReferences | null,
): string {
  if (references === null) return markdown;
  return markdownWithTextLinks(markdown, references.pattern, (match) =>
    linearIssueReferenceUrl(references.workspaceUrlKey, match[0]),
  );
}

/**
 * Fork: `owner/repo#123`, and `#123` when the thread's repository is on GitHub, link to GitHub as
 * on the web, so they read as the issue or pull request's link pill.
 */
export function markdownWithGitHubIssueLinks(
  markdown: string,
  repositoryUrl: string | null,
): string {
  if (!mayHaveGitHubIssueReference(markdown)) return markdown;
  return markdownWithTextLinks(markdown, GITHUB_ISSUE_REFERENCE, (match) =>
    githubIssueReferenceUrl(match[1], match[2]!, repositoryUrl),
  );
}

/** Links each match of a global pattern in prose; code, existing links, and escapes stay. */
function markdownWithTextLinks(
  markdown: string,
  pattern: RegExp,
  urlFor: (match: RegExpExecArray) => string | null,
): string {
  if (markdown.search(pattern) === -1) return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "link" || node.type === "linkReference") return;
    if (node.type === "text") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // Escapes and entities make the source differ from the text; such runs stay as written.
      if (start === undefined || end === undefined || markdown.slice(start, end) !== node.value)
        return;
      for (const match of node.value.matchAll(pattern)) {
        const url = urlFor(match);
        if (url === null) continue;
        const offset = start + match.index;
        edits.push({
          start: offset,
          end: offset + match[0].length,
          content: `[${match[0]}](${url})`,
        });
      }
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}

function isObjectLinkCandidate(url: string): boolean {
  return objectLinkLabel(url.replace(/[.,;:!?]+$/u, "")) !== null;
}

// A delimiter row such as `|---|:--:|`, possibly inside a blockquote or list item.
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const row = line.replace(/^[ \t>]+/, "").trim();
  return row
    .replace(/^\||\|$/g, "")
    .split("|")
    .every((cell) => /^:?-+:?$/.test(cell.trim()));
}

// Cheap pre-check for a delimiter row two lines below text, so most messages skip the parse.
function mayHaveTableUnderText(markdown: string): boolean {
  if (!markdown.includes("|")) return false;
  const lines = markdown.split(/\r\n|\r|\n/);
  for (let index = 2; index < lines.length; index += 1) {
    if (isTableDelimiterRow(lines[index]!) && /[^\s>]/.test(lines[index - 2]!)) return true;
  }
  return false;
}

/**
 * GFM lets a table interrupt a paragraph, but the native parser (md4c) only starts a table
 * on a paragraph's first line, so a table right under a line of text renders as one
 * run-on paragraph. Insert the blank line md4c needs before each such table.
 */
export function markdownWithTableBreaks(markdown: string): string {
  if (!mayHaveTableUnderText(markdown)) return markdown;
  const lineStarts: number[] = [];
  const visit = (node: MarkdownNode) => {
    if (!("children" in node)) return;
    node.children.forEach((child, index) => {
      const previous = node.children[index - 1];
      const start = child.position?.start;
      if (
        child.type === "table" &&
        previous?.type === "paragraph" &&
        start?.offset !== undefined &&
        previous.position?.end.line === start.line - 1
      )
        lineStarts.push(
          Math.max(
            markdown.lastIndexOf("\n", start.offset - 1),
            markdown.lastIndexOf("\r", start.offset - 1),
          ) + 1,
        );
      visit(child);
    });
  };
  visit(parser.parse(markdown));
  for (const lineStart of lineStarts.reverse()) {
    // The header row may be a lazy line without its container markers (`>` or list indent),
    // so copy the delimiter row's markers onto the blank line and the header row.
    const [, header = "", cells = "", ending = "\n", markers = ""] =
      /^([ \t>]*)([^\r\n]*)(\r\n|\r|\n)([ \t>]*)/.exec(markdown.slice(lineStart)) ?? [];
    markdown =
      markdown.slice(0, lineStart) +
      `${markers.trimEnd()}${ending}${markers}${cells}` +
      markdown.slice(lineStart + header.length + cells.length);
  }
  return markdown;
}

export function parseMarkdownDocument(markdown: string): Root {
  return parser.parse(markdownWithHtml(markdown));
}

const INLINE_CODE_SPAN = /`+([^`\r\n]+)`+/g;

export function markdownWithInlineFileLinks(markdown: string, fileLink: RegExp): string {
  if (![...markdown.matchAll(INLINE_CODE_SPAN)].some(([, code]) => fileLink.test(code!.trim())))
    return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const escaped = node.value.replace(/[\\[\]&]/g, "\\$&");
      if (
        start !== undefined &&
        end !== undefined &&
        fileLink.test(node.value) &&
        !/[<>]/.test(node.value)
      )
        edits.push({
          start,
          end,
          content: `[${escaped}](<${escaped}>)`,
        });
    } else if (node.type !== "link" && node.type !== "linkReference" && "children" in node)
      node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}
