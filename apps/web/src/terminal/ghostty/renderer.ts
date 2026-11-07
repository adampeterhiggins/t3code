import {
  GHOSTTY_CELL_WIDE,
  ghosttyColorsEqual,
  type GhosttyCell,
  type GhosttyColor,
  type GhosttySnapshot,
} from "./core";

export interface GhosttyCellMetrics {
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
}

export interface GhosttyCellRange {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

const DEFAULT_SELECTION_BACKGROUND = "rgba(72, 122, 191, 0.35)";

function cssColor(color: GhosttyColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function sameTextStyle(left: GhosttyCell, right: GhosttyCell): boolean {
  // Selection only tints the background; splitting text runs shifts glyph spacing when advances differ from cell width.
  return (
    ghosttyColorsEqual(left.foreground, right.foreground) &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.invisible === right.invisible
  );
}

export function ghosttyTextRunEnd(
  cells: readonly GhosttyCell[],
  start: number,
  sameStyle: (cell: GhosttyCell) => boolean,
): number {
  let end = start + 1;
  while (end < cells.length) {
    const next = cells[end];
    if (!next) break;
    if (next.wide === GHOSTTY_CELL_WIDE.spacerTail) {
      end += 1;
      continue;
    }
    if (
      next.text.length === 0 ||
      POWERLINE_SEPARATORS.has(next.text) ||
      isIconGlyph(next.text) ||
      !sameStyle(next)
    ) {
      break;
    }
    end += 1;
  }
  return end;
}

type PowerlineSeparator = Readonly<{ side: "left" | "right"; solid: boolean }>;

/**
 * Powerline separators, drawn as shapes that fill the cell the way Ghostty and
 * xterm.js draw them. A font glyph only spans the face's own height, so on a
 * taller cell it leaves slivers between prompt segments.
 */
const POWERLINE_SEPARATORS: ReadonlyMap<string, PowerlineSeparator> = new Map([
  ["\ue0b0", { side: "right", solid: true }],
  ["\ue0b1", { side: "right", solid: false }],
  ["\ue0b2", { side: "left", solid: true }],
  ["\ue0b3", { side: "left", solid: false }],
]);

function drawPowerlineSeparator(
  context: CanvasRenderingContext2D,
  separator: PowerlineSeparator,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const base = separator.side === "right" ? left : left + width;
  const tip = separator.side === "right" ? left + width : left;
  context.beginPath();
  if (separator.solid) {
    // Cells start at fractional pixels, so the base edge would anti-alias over
    // a pixel the cell background already half-covered and leave a seam. The
    // segment behind the base is the arrow's own color, so overlap it by 1px.
    const behind = separator.side === "right" ? base - 1 : base + 1;
    context.moveTo(behind, top);
    context.lineTo(base, top);
    context.lineTo(tip, top + height / 2);
    context.lineTo(base, top + height);
    context.lineTo(behind, top + height);
    context.closePath();
    context.fill();
  } else {
    context.moveTo(base, top);
    context.lineTo(tip, top + height / 2);
    context.lineTo(base, top + height);
    context.lineWidth = 1;
    context.strokeStyle = context.fillStyle;
    context.stroke();
  }
}

// Nerd Font icons live in the private-use planes. Powerline and powerline-extra
// glyphs (U+E0A0–U+E0D7) are cell-shaped, so they keep their font placement.
function isIconGlyph(text: string): boolean {
  const code = text.codePointAt(0);
  if (code === undefined || (code >= 0xe0a0 && code <= 0xe0d7)) return false;
  return (code >= 0xe000 && code <= 0xf8ff) || (code >= 0xf0000 && code <= 0xffffd);
}

const ICON_HEIGHT_EM = 0.7;

/**
 * Fits an icon's ink inside `width` and 0.7em of height, keeping its
 * proportions, and centres it in the row, as Ghostty does. Drawn on the
 * baseline, icons ride low in tall rows and get squashed to one cell.
 */
function drawIconGlyph(
  context: CanvasRenderingContext2D,
  text: string,
  left: number,
  top: number,
  width: number,
  metrics: GhosttyCellMetrics,
  fontSize: number,
): void {
  const ink = context.measureText(text);
  const inkWidth = ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight;
  const inkHeight = ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent;
  if (!(inkWidth > 0 && inkHeight > 0)) {
    context.fillText(text, left, top + metrics.baseline, width);
    return;
  }
  const maxHeight = Math.min(fontSize * ICON_HEIGHT_EM, metrics.height);
  const scale = Math.min(width / inkWidth, maxHeight / inkHeight);
  context.save();
  context.beginPath();
  context.rect(left, top, width, metrics.height);
  context.clip();
  // Icons wider than a cell start at its left edge, keeping the gap before the next word.
  const centreX = left + Math.max(metrics.width, inkWidth * scale) / 2;
  context.translate(centreX, top + metrics.height / 2);
  context.scale(scale, scale);
  context.fillText(
    text,
    (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2,
    (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
  );
  context.restore();
}

function fontForCell(cell: GhosttyCell, fontSize: number, fontFamily: string): string {
  const style = cell.italic ? "italic" : "normal";
  const weight = cell.bold ? "700" : "400";
  return `${style} ${weight} ${fontSize}px ${fontFamily}`;
}

/**
 * `lineHeight` is a multiple of the font size, like CSS `line-height`. The
 * face's line box is centred in the row, as xterm.js does, so text without
 * descenders sits in the middle instead of riding high.
 */
export function measureGhosttyCell(
  context: CanvasRenderingContext2D,
  fontSize: number,
  fontFamily: string,
  lineHeight = 1.35,
): GhosttyCellMetrics {
  context.font = `normal 400 ${fontSize}px ${fontFamily}`;
  const widthMeasurement = context.measureText("M");
  const verticalMeasurement = context.measureText("Mg");
  const ascent = verticalMeasurement.actualBoundingBoxAscent || fontSize;
  const descent = verticalMeasurement.actualBoundingBoxDescent;
  const glyphHeight = ascent + descent;
  const height = Math.max(1, Math.round(fontSize * lineHeight), Math.ceil(glyphHeight));
  const fontAscent = verticalMeasurement.fontBoundingBoxAscent;
  const fontDescent = verticalMeasurement.fontBoundingBoxDescent;
  const baseline =
    fontAscent > 0 && fontDescent >= 0
      ? (height - fontAscent - fontDescent) / 2 + fontAscent
      : (height - glyphHeight) / 2 + ascent;
  return {
    width: Math.max(1, widthMeasurement.width),
    height,
    baseline: Math.round(baseline),
  };
}

export function terminalGridSize(
  width: number,
  height: number,
  metrics: GhosttyCellMetrics,
  padding: number,
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width - padding * 2) / metrics.width)),
    rows: Math.max(1, Math.floor((height - padding * 2) / metrics.height)),
  };
}

export function renderGhosttySnapshot(options: {
  readonly context: CanvasRenderingContext2D;
  readonly snapshot: GhosttySnapshot;
  readonly metrics: GhosttyCellMetrics;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly padding: number;
  readonly forceFull: boolean;
  readonly cursorOn: boolean;
  readonly previousCursorY?: number | null;
  readonly focused?: boolean;
  readonly selectionBackground?: string;
  readonly hoveredLinkRange?: GhosttyCellRange | null;
  readonly originY?: number;
}): void {
  const {
    context,
    snapshot,
    metrics,
    fontSize,
    fontFamily,
    padding,
    forceFull,
    cursorOn,
    previousCursorY,
  } = options;
  const focused = options.focused ?? true;
  const selectionBackground = options.selectionBackground ?? DEFAULT_SELECTION_BACKGROUND;
  const hoveredLinkRange = options.hoveredLinkRange ?? null;
  const originY = options.originY ?? padding;
  const rowsToDraw = forceFull
    ? Array.from({ length: snapshot.rows }, (_, index) => index)
    : [...snapshot.dirtyRows];
  if (
    previousCursorY !== null &&
    previousCursorY !== undefined &&
    previousCursorY >= 0 &&
    !rowsToDraw.includes(previousCursorY)
  ) {
    rowsToDraw.push(previousCursorY);
  }
  if (snapshot.cursorVisible && snapshot.cursorY >= 0 && !rowsToDraw.includes(snapshot.cursorY)) {
    rowsToDraw.push(snapshot.cursorY);
  }

  if (forceFull) {
    context.save();
    context.resetTransform();
    context.fillStyle = cssColor(snapshot.background);
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.restore();
  }

  context.textBaseline = "alphabetic";
  for (const rowIndex of rowsToDraw) {
    const row = snapshot.rowData[rowIndex];
    if (!row) continue;
    const top = originY + rowIndex * metrics.height;

    context.fillStyle = cssColor(snapshot.background);
    context.fillRect(padding, top, snapshot.cols * metrics.width, metrics.height);

    let backgroundStart = 0;
    while (backgroundStart < row.cells.length) {
      const first = row.cells[backgroundStart];
      if (!first) break;
      let backgroundEnd = backgroundStart + 1;
      while (backgroundEnd < row.cells.length) {
        const next = row.cells[backgroundEnd];
        if (
          !next ||
          next.selected !== first.selected ||
          !ghosttyColorsEqual(next.background, first.background)
        ) {
          break;
        }
        backgroundEnd += 1;
      }
      if (first.selected || !ghosttyColorsEqual(first.background, snapshot.background)) {
        const left = padding + backgroundStart * metrics.width;
        const width = (backgroundEnd - backgroundStart) * metrics.width;
        if (!ghosttyColorsEqual(first.background, snapshot.background)) {
          context.fillStyle = cssColor(first.background);
          context.fillRect(left, top, width, metrics.height);
        }
        if (first.selected) {
          context.fillStyle = selectionBackground;
          context.fillRect(left, top, width, metrics.height);
        }
      }
      backgroundStart = backgroundEnd;
    }

    let runStart = 0;
    while (runStart < row.cells.length) {
      const first = row.cells[runStart];
      if (!first) break;
      if (first.text.length === 0) {
        runStart += 1;
        continue;
      }
      const separator = POWERLINE_SEPARATORS.get(first.text);
      if (separator) {
        if (!first.invisible) {
          context.fillStyle = cssColor(first.foreground);
          drawPowerlineSeparator(
            context,
            separator,
            padding + runStart * metrics.width,
            top,
            metrics.width,
            metrics.height,
          );
        }
        runStart += 1;
        continue;
      }
      if (isIconGlyph(first.text)) {
        if (!first.invisible) {
          const next = row.cells[runStart + 1];
          const spread =
            first.wide === GHOSTTY_CELL_WIDE.wide || next?.text === "" || next?.text === " ";
          context.font = fontForCell(first, fontSize, fontFamily);
          context.fillStyle = cssColor(first.foreground);
          drawIconGlyph(
            context,
            first.text,
            padding + runStart * metrics.width,
            top,
            (spread ? 2 : 1) * metrics.width,
            metrics,
            fontSize,
          );
        }
        runStart += 1;
        continue;
      }
      const runEnd = ghosttyTextRunEnd(
        row.cells,
        runStart,
        (cell) => sameTextStyle(cell, first) && !POWERLINE_SEPARATORS.has(cell.text),
      );
      const text = row.cells
        .slice(runStart, runEnd)
        .map((cell) => cell.text)
        .join("");
      if (!first.invisible && text.trim().length > 0) {
        context.save();
        context.beginPath();
        context.rect(
          padding + runStart * metrics.width,
          top,
          (runEnd - runStart) * metrics.width,
          metrics.height,
        );
        context.clip();
        context.font = fontForCell(first, fontSize, fontFamily);
        context.fillStyle = cssColor(first.foreground);
        context.fillText(
          text,
          padding + runStart * metrics.width,
          top + metrics.baseline,
          (runEnd - runStart) * metrics.width,
        );
        context.restore();
      }
      runStart = runEnd;
    }

    for (let column = 0; column < row.cells.length; column += 1) {
      const cell = row.cells[column];
      const hoveredLink =
        hoveredLinkRange !== null &&
        rowIndex >= hoveredLinkRange.start.y &&
        rowIndex <= hoveredLinkRange.end.y &&
        (rowIndex > hoveredLinkRange.start.y || column >= hoveredLinkRange.start.x) &&
        (rowIndex < hoveredLinkRange.end.y || column <= hoveredLinkRange.end.x);
      if (!cell || (!cell.underline && !cell.strikethrough && !cell.overline && !hoveredLink)) {
        continue;
      }
      context.fillStyle = cssColor(cell.foreground);
      const left = padding + column * metrics.width;
      if (cell.underline || hoveredLink) {
        context.fillRect(left, top + metrics.height - 2, metrics.width, 1);
      }
      if (cell.strikethrough) {
        context.fillRect(left, top + Math.floor(metrics.height * 0.55), metrics.width, 1);
      }
      if (cell.overline) context.fillRect(left, top + 1, metrics.width, 1);
    }
  }

  if (cursorOn && snapshot.cursorVisible && snapshot.cursorX >= 0 && snapshot.cursorY >= 0) {
    const left = padding + snapshot.cursorX * metrics.width;
    const top = originY + snapshot.cursorY * metrics.height;
    context.fillStyle = cssColor(snapshot.cursor);
    if (!focused) {
      context.strokeStyle = cssColor(snapshot.cursor);
      context.strokeRect(left + 0.5, top + 0.5, metrics.width - 1, metrics.height - 1);
    } else if (snapshot.cursorStyle === 0) {
      context.fillRect(left, top, 2, metrics.height);
    } else if (snapshot.cursorStyle === 2) {
      context.fillRect(left, top + metrics.height - 2, metrics.width, 2);
    } else if (snapshot.cursorStyle === 3) {
      context.strokeStyle = cssColor(snapshot.cursor);
      context.strokeRect(left + 0.5, top + 0.5, metrics.width - 1, metrics.height - 1);
    } else {
      context.fillRect(left, top, metrics.width, metrics.height);
      const cell = snapshot.rowData[snapshot.cursorY]?.cells[snapshot.cursorX];
      if (cell?.text) {
        context.fillStyle = cssColor(snapshot.background);
        const separator = POWERLINE_SEPARATORS.get(cell.text);
        if (separator) {
          drawPowerlineSeparator(context, separator, left, top, metrics.width, metrics.height);
        } else {
          context.font = fontForCell(cell, fontSize, fontFamily);
          if (isIconGlyph(cell.text)) {
            drawIconGlyph(context, cell.text, left, top, metrics.width, metrics, fontSize);
          } else {
            context.fillText(cell.text, left, top + metrics.baseline, metrics.width);
          }
        }
      }
    }
  }
}
