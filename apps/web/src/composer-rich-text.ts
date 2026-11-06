import { collectComposerPromptInlineTokens } from "~/composer-editor-mentions";

export type RichTextStyle = "bold" | "italic" | "strike" | "code";
/** A link carries its destination, so adjacent links to different places stay apart. */
export type RichTextMark = RichTextStyle | `link:${string}`;

export function linkMark(href: string): RichTextMark {
  return `link:${href}`;
}

export function linkHref(mark: RichTextMark): string | null {
  return mark.startsWith("link:") ? mark.slice("link:".length) : null;
}

interface RichTextSpan {
  text: string;
  marks: RichTextMark[];
}

const STYLE_DELIMITERS: Record<RichTextStyle, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

export function richTextDelimiters(mark: RichTextMark): { open: string; close: string } {
  const href = linkHref(mark);
  if (href !== null) return { open: "[", close: `](${href})` };
  const delimiter = STYLE_DELIMITERS[mark as RichTextStyle];
  return { open: delimiter, close: delimiter };
}

// Bounds the rescan an unmatched `[` costs, like the composer's other link tokens.
const MAX_LINK_LABEL_LENGTH = 512;
// One level of balanced parentheses, so links like Wikipedia's keep their closing `)`.
const LINK_DESTINATION = /\(((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)\)/y;

/** File links named for their file, and context or citation links, are chips rather than links. */
export function isChipLinkSource(source: string): boolean {
  return collectComposerPromptInlineTokens(`${source} `).some(
    (token) => token.start === 0 && token.end === source.length,
  );
}

/** The `[label](href)` link whose `[` is at `start`, or null. */
function matchLink(
  text: string,
  start: number,
): { labelEnd: number; end: number; href: string } | null {
  let depth = 0;
  const limit = Math.min(text.length, start + MAX_LINK_LABEL_LENGTH + 2);
  for (let index = start + 1; index < limit; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "\n") return null;
    else if (char === "[") depth += 1;
    else if (char === "]" && depth > 0) depth -= 1;
    else if (char === "]") {
      if (index === start + 1) return null;
      LINK_DESTINATION.lastIndex = index + 1;
      const destination = LINK_DESTINATION.exec(text);
      if (!destination) return null;
      const end = index + 1 + destination[0].length;
      if (isChipLinkSource(text.slice(start, end))) return null;
      return {
        labelEnd: index,
        end,
        href: destination[1]!,
      };
    }
  }
  return null;
}

/** A run of `text` from `start` to `end` that parses with `marks`. */
interface SourcePiece {
  start: number;
  end: number;
  marks: RichTextMark[];
}

function sameMarks(left: readonly RichTextMark[], right: readonly RichTextMark[]): boolean {
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

// Pieces keep source offsets, so callers can map parsed text back onto the
// characters it came from; parsing only drops delimiters.
function parseInlineMarkdownPieces(text: string, inLink = false): SourcePiece[] {
  const root: SourcePiece[] = [];
  const stack: { delimiter: string; mark: RichTextMark; start: number; pieces: SourcePiece[] }[] =
    [];
  const push = (start: number, end: number, marks: RichTextMark[] = []) => {
    if (end <= start) return;
    const pieces = stack.at(-1)?.pieces ?? root;
    const last = pieces.at(-1);
    if (last?.end === start && sameMarks(last.marks, marks)) last.end = end;
    else pieces.push({ start, end, marks });
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      push(index, Math.min(index + 2, text.length));
      index += 2;
      continue;
    }
    if (char === "`") {
      const run = text.slice(index).match(/^`+/)![0];
      const close = text.indexOf(run, index + run.length);
      if (
        run.length === 1 &&
        close > index + 1 &&
        !text.slice(index, close).includes("\n") &&
        text[close + 1] !== "`"
      ) {
        push(index + 1, close, ["code"]);
        index = close + 1;
      } else {
        push(index, index + run.length);
        index += run.length;
      }
      continue;
    }
    const link = char === "[" && !inLink ? matchLink(text, index) : null;
    if (link) {
      // Links bind tighter than emphasis, so the label parses on its own and cannot contain a link.
      const label = text.slice(index + 1, link.labelEnd);
      for (const piece of parseInlineMarkdownPieces(label, true)) {
        push(index + 1 + piece.start, index + 1 + piece.end, [linkMark(link.href), ...piece.marks]);
      }
      index = link.end;
      continue;
    }
    if (char !== "*" && char !== "_" && char !== "~") {
      push(index, index + 1);
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === char) end += 1;
    const before = text[index - 1] ?? "";
    const after = text[end] ?? "";
    const canClose = before !== "" && !/\s/.test(before) && (char !== "_" || !/\w/.test(after));
    const canOpen = after !== "" && !/\s/.test(after) && (char !== "_" || !/\w/.test(before));
    while (index < end) {
      const top = stack.at(-1);
      const opensNestedBold =
        top?.mark === "italic" &&
        end - index === 2 &&
        canOpen &&
        (char === "*" || char === "_") &&
        !stack.some((frame) => frame.mark === "bold");
      if (
        !opensNestedBold &&
        canClose &&
        top &&
        text.startsWith(top.delimiter, index) &&
        index + top.delimiter.length <= end
      ) {
        stack.pop();
        for (const piece of top.pieces) push(piece.start, piece.end, [top.mark, ...piece.marks]);
        index += top.delimiter.length;
      } else if (canOpen && (char !== "~" || end - index >= 2)) {
        const length = char === "~" || end - index >= 2 ? 2 : 1;
        const mark = char === "~" ? "strike" : length === 2 ? "bold" : "italic";
        // Prevent self-nesting, including alternate delimiters, to bound the stack by supported styles.
        if (stack.some((frame) => frame.mark === mark)) {
          push(index, end);
          index = end;
          continue;
        }
        stack.push({ delimiter: char.repeat(length), mark, start: index, pieces: [] });
        index += length;
      } else {
        push(index, end);
        index = end;
      }
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    push(frame.start, frame.start + frame.delimiter.length);
    for (const piece of frame.pieces) push(piece.start, piece.end, piece.marks);
  }
  return root;
}

export function parseInlineMarkdown(text: string): RichTextSpan[] {
  const spans: RichTextSpan[] = [];
  for (const { start, end, marks } of parseInlineMarkdownPieces(text)) {
    const last = spans.at(-1);
    if (last && sameMarks(last.marks, marks)) {
      last.text += text.slice(start, end);
    } else {
      spans.push({ text: text.slice(start, end), marks });
    }
  }
  return spans;
}

/** Marks text the composer shows as editable Markdown source while the caret is in it. */
export const MARKDOWN_SOURCE_MARK = "markdownSource";

/** Marks for each UTF-16 unit of `text`, or null for a delimiter that parsing drops. */
export function inlineMarkdownUnitMarks(text: string): Array<RichTextMark[] | null> {
  const result: Array<RichTextMark[] | null> = Array.from({ length: text.length }, () => null);
  for (const { start, end, marks } of parseInlineMarkdownPieces(text)) {
    result.fill(marks, start, end);
  }
  return result;
}
