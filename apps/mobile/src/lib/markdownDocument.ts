import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { objectLinkLabel } from "@t3tools/shared/composerObjectLinks";
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

/** Called only for parsed HTML nodes, so Markdown code examples keep their literal tags. */
export function markdownHtmlContent(content: string): string {
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
  return content.replace(HTML_TAG, (tag, offset: number) => {
    if (codeRanges.some((range) => offset >= range.start && offset < range.end)) return tag;
    if (tag.startsWith("<!--")) return "";
    if (/^<img\b/i.test(tag)) {
      const src = attribute(tag, "src");
      if (!src) return "";
      const alt = (attribute(tag, "alt") ?? "").replace(/[\\[\]&]/g, "\\$&");
      const href = src
        .replace(/&/g, "\\&")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E")
        .replace(/\n/g, "");
      return `![${alt}](<${href}>)`;
    }
    if (/^<summary\b/i.test(tag)) return "\n\n**";
    if (/^<\/summary\s*>/i.test(tag)) return "**\n\n";
    if (/^<br\b/i.test(tag)) return "  \n";
    if (/^<\/?(?:p|div|details)\b/i.test(tag)) return "\n\n";
    return "";
  });
}

export function markdownWithHtml(markdown: string): string {
  if (!/<(?:!--|\/?[a-z])/i.test(markdown)) return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "html") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        edits.push({ start, end, content: markdownHtmlContent(node.value) });
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
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
