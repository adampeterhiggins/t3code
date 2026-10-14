import type { GhosttyColor } from "~/terminal/ghostty/core";

/** A palette slot (resolved against the terminal theme at render time) or a literal color. */
export type TerminalTextColor =
  | { readonly kind: "palette"; readonly index: number }
  | { readonly kind: "rgb"; readonly r: number; readonly g: number; readonly b: number };

export interface TerminalTextStyle {
  readonly foreground: TerminalTextColor | null;
  readonly background: TerminalTextColor | null;
  readonly bold: boolean;
  readonly faint: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
  readonly overline: boolean;
  readonly inverse: boolean;
  readonly invisible: boolean;
}

export interface TerminalTextRun {
  readonly text: string;
  readonly style: TerminalTextStyle;
}

const PLAIN_STYLE: TerminalTextStyle = {
  foreground: null,
  background: null,
  bold: false,
  faint: false,
  italic: false,
  underline: false,
  strikethrough: false,
  overline: false,
  inverse: false,
  invisible: false,
};

// CSI sequences (SGR and anything else), OSC sequences ended by BEL or ST, and lone escapes.
// oxlint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\x1b\[([0-9:;?<=>]*)([ -/]*[@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b./g;

function readExtendedColor(
  params: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
): { color: TerminalTextColor | null; consumed: number } {
  const param = params[index]!;
  // Colon form keeps the color in one parameter: 38:5:n or 38:2:[colorspace:]r:g:b.
  if (param.length > 1) {
    if (param[1] === 5 && param[2] !== undefined) {
      return { color: { kind: "palette", index: param[2] }, consumed: 1 };
    }
    if (param[1] === 2) {
      const [r, g, b] = param.length >= 6 ? param.slice(3, 6) : param.slice(2, 5);
      if (r !== undefined && g !== undefined && b !== undefined) {
        return { color: { kind: "rgb", r, g, b }, consumed: 1 };
      }
    }
    return { color: null, consumed: 1 };
  }
  const mode = params[index + 1]?.[0];
  if (mode === 5) {
    const slot = params[index + 2]?.[0];
    return {
      color: slot === undefined ? null : { kind: "palette", index: slot },
      consumed: 3,
    };
  }
  if (mode === 2) {
    const [r, g, b] = [2, 3, 4].map((offset) => params[index + offset]?.[0]);
    return {
      color:
        r === undefined || g === undefined || b === undefined ? null : { kind: "rgb", r, g, b },
      consumed: 5,
    };
  }
  return { color: null, consumed: 1 };
}

function applySgr(style: TerminalTextStyle, rawParams: string): TerminalTextStyle {
  const params = (rawParams.length === 0 ? "0" : rawParams)
    .split(";")
    .map((param) => param.split(":").map((part) => (part.length === 0 ? 0 : Number(part))));
  let next = style;
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index]![0]!;
    if (code === 38 || code === 48) {
      const { color, consumed } = readExtendedColor(params, index);
      next = code === 38 ? { ...next, foreground: color } : { ...next, background: color };
      index += consumed - 1;
    } else if (code === 0) next = PLAIN_STYLE;
    else if (code === 1) next = { ...next, bold: true };
    else if (code === 2) next = { ...next, faint: true };
    else if (code === 3) next = { ...next, italic: true };
    // 4:0 turns underline off; any other 4 sub-style (curly, dotted, ...) draws one.
    else if (code === 4) next = { ...next, underline: params[index]![1] !== 0 };
    else if (code === 7) next = { ...next, inverse: true };
    else if (code === 8) next = { ...next, invisible: true };
    else if (code === 9) next = { ...next, strikethrough: true };
    else if (code === 21) next = { ...next, underline: true };
    else if (code === 22) next = { ...next, bold: false, faint: false };
    else if (code === 23) next = { ...next, italic: false };
    else if (code === 24) next = { ...next, underline: false };
    else if (code === 27) next = { ...next, inverse: false };
    else if (code === 28) next = { ...next, invisible: false };
    else if (code === 29) next = { ...next, strikethrough: false };
    else if (code === 39) next = { ...next, foreground: null };
    else if (code === 49) next = { ...next, background: null };
    else if (code === 53) next = { ...next, overline: true };
    else if (code === 55) next = { ...next, overline: false };
    else if (code >= 30 && code <= 37) {
      next = { ...next, foreground: { kind: "palette", index: code - 30 } };
    } else if (code >= 40 && code <= 47) {
      next = { ...next, background: { kind: "palette", index: code - 40 } };
    } else if (code >= 90 && code <= 97) {
      next = { ...next, foreground: { kind: "palette", index: code - 90 + 8 } };
    } else if (code >= 100 && code <= 107) {
      next = { ...next, background: { kind: "palette", index: code - 100 + 8 } };
    }
  }
  return next;
}

/**
 * Split terminal text with escape sequences into styled runs. SGR sequences set the style;
 * every other sequence (cursor moves, OSC hyperlinks, titles) is dropped.
 */
export function parseTerminalStyledText(input: string): TerminalTextRun[] {
  const runs: TerminalTextRun[] = [];
  let style = PLAIN_STYLE;
  let cursor = 0;
  const push = (text: string) => {
    if (text.length === 0) return;
    const last = runs.at(-1);
    if (last && last.style === style) {
      runs[runs.length - 1] = { text: last.text + text, style };
    } else {
      runs.push({ text, style });
    }
  };
  for (const match of input.matchAll(ESCAPE_PATTERN)) {
    push(input.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[2] === "m" && match[1] !== undefined) style = applySgr(style, match[1]);
  }
  push(input.slice(cursor));
  return runs;
}

/**
 * Keep only the text and its SGR sequences. Ghostty's VT selection output also carries
 * terminal state, such as the whole 256-color palette as OSC 4, that a preview never needs.
 */
export function stripNonSgrSequences(input: string): string {
  return input.replace(ESCAPE_PATTERN, (sequence, _params, final) =>
    final === "m" ? sequence : "",
  );
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

/** The xterm 256-color palette above the 16 theme colors: a 6×6×6 cube, then a gray ramp. */
function extendedPaletteColor(index: number): GhosttyColor {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return { r: level, g: level, b: level };
  }
  const cube = index - 16;
  return {
    r: CUBE_LEVELS[Math.floor(cube / 36) % 6]!,
    g: CUBE_LEVELS[Math.floor(cube / 6) % 6]!,
    b: CUBE_LEVELS[cube % 6]!,
  };
}

function cssColor({ r, g, b }: GhosttyColor): string {
  return `rgb(${r} ${g} ${b})`;
}

export function resolveTerminalTextColor(
  color: TerminalTextColor,
  palette: ReadonlyArray<GhosttyColor>,
): string | undefined {
  if (color.kind === "rgb") return cssColor(color);
  if (color.index < 0 || color.index > 255) return undefined;
  const themed = color.index < 16 ? palette[color.index] : extendedPaletteColor(color.index);
  return themed === undefined ? undefined : cssColor(themed);
}
