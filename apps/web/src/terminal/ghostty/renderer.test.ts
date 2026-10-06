import { describe, expect, it } from "vite-plus/test";

import { GHOSTTY_CELL_WIDE, type GhosttyCell, type GhosttySnapshot } from "./core";
import {
  ghosttyTextRunEnd,
  measureGhosttyCell,
  renderGhosttySnapshot,
  terminalGridSize,
} from "./renderer";

const cell = (text: string, wide = 0): GhosttyCell => ({
  text,
  wide,
  foreground: { r: 255, g: 255, b: 255 },
  background: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  invisible: false,
  strikethrough: false,
  overline: false,
  underline: false,
  selected: false,
});

describe("terminalGridSize", () => {
  it("matches the mobile renderer's cell-and-padding sizing model", () => {
    expect(terminalGridSize(808, 408, { width: 10, height: 20, baseline: 15 }, 4)).toEqual({
      cols: 80,
      rows: 20,
    });
  });

  it("never sends an invalid zero-sized terminal to libghostty", () => {
    expect(terminalGridSize(0, 0, { width: 10, height: 20, baseline: 15 }, 4)).toEqual({
      cols: 1,
      rows: 1,
    });
  });
});

describe("measureGhosttyCell", () => {
  it("uses descender-aware metrics and the mobile terminal line-height", () => {
    const measureText = (text: string) =>
      text === "M"
        ? { width: 7.2, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 0 }
        : { width: 14.4, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 };
    const context = {
      font: "",
      measureText,
    } as unknown as CanvasRenderingContext2D;

    expect(measureGhosttyCell(context, 12, "monospace")).toEqual({
      width: 7.2,
      height: 16,
      baseline: 11,
    });
  });
});

describe("measureGhosttyCell line height", () => {
  it("sizes rows by the line height and centres the face's line box in them", () => {
    // Geist Mono at 14px: a 1.3em line box (ascent 1.005em, descent 0.295em).
    const context = {
      font: "",
      measureText: (text: string) => ({
        width: text === "M" ? 8.4 : 16.8,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: text === "M" ? 0 : 3,
        fontBoundingBoxAscent: 14.07,
        fontBoundingBoxDescent: 4.13,
      }),
    } as unknown as CanvasRenderingContext2D;

    expect(measureGhosttyCell(context, 14, "Geist Mono", 1.6)).toEqual({
      width: 8.4,
      height: 22,
      // (22 - 18.2) / 2 + 14.07: equal room above the ascender and below the descender.
      baseline: 16,
    });
    expect(measureGhosttyCell(context, 14, "Geist Mono").height).toBe(19);
  });
});

describe("ghosttyTextRunEnd", () => {
  it("includes wide spacer tails in the visual clip without rendering spaces", () => {
    const cells = [
      cell("界", GHOSTTY_CELL_WIDE.wide),
      cell("", GHOSTTY_CELL_WIDE.spacerTail),
      cell("🙂", GHOSTTY_CELL_WIDE.wide),
      cell("", GHOSTTY_CELL_WIDE.spacerTail),
      cell(""),
    ];
    expect(ghosttyTextRunEnd(cells, 0, () => true)).toBe(4);
  });
});

describe("renderGhosttySnapshot", () => {
  it("underlines every cell in a hovered wrapped link", () => {
    const fillRectCalls: number[][] = [];
    const context = {
      canvas: { width: 200, height: 80 },
      beginPath: () => {},
      clip: () => {},
      fillRect: (...args: number[]) => fillRectCalls.push(args),
      fillText: () => {},
      rect: () => {},
      resetTransform: () => {},
      restore: () => {},
      save: () => {},
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    } as unknown as CanvasRenderingContext2D;
    const snapshot: GhosttySnapshot = {
      cols: 4,
      rows: 2,
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 },
      cursorX: -1,
      cursorY: -1,
      cursorVisible: false,
      cursorBlinking: false,
      cursorStyle: 1,
      dirtyRows: new Set([0, 1]),
      rowData: [0, 1].map(() => ({
        cells: [cell("a"), cell("b"), cell("c"), cell("d")],
        text: "abcd",
        isWrapContinuation: false,
        wrapsToNext: false,
      })),
    };

    renderGhosttySnapshot({
      context,
      snapshot,
      metrics: { width: 10, height: 20, baseline: 15 },
      fontSize: 12,
      fontFamily: "monospace",
      padding: 4,
      forceFull: false,
      cursorOn: false,
      hoveredLinkRange: { start: { x: 2, y: 0 }, end: { x: 1, y: 1 } },
    });

    expect(fillRectCalls.filter(([, , , height]) => height === 1)).toEqual([
      [24, 22, 10, 1],
      [34, 22, 10, 1],
      [4, 42, 10, 1],
      [14, 42, 10, 1],
    ]);
  });

  it("constrains text runs and cursor glyphs to their terminal cells", () => {
    const fillTextCalls: unknown[][] = [];
    const context = {
      canvas: { width: 200, height: 40 },
      beginPath: () => {},
      clip: () => {},
      fillRect: () => {},
      fillText: (...args: unknown[]) => fillTextCalls.push(args),
      rect: () => {},
      resetTransform: () => {},
      restore: () => {},
      save: () => {},
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    } as unknown as CanvasRenderingContext2D;
    const cells = [cell("a"), cell("b"), cell("x")];
    const snapshot: GhosttySnapshot = {
      cols: 3,
      rows: 1,
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 },
      cursorX: 2,
      cursorY: 0,
      cursorVisible: true,
      cursorBlinking: false,
      cursorStyle: 1,
      dirtyRows: new Set([0]),
      rowData: [{ cells, text: "abx", isWrapContinuation: false, wrapsToNext: false }],
    };

    renderGhosttySnapshot({
      context,
      snapshot,
      metrics: { width: 7.2, height: 16, baseline: 11 },
      fontSize: 12,
      fontFamily: "monospace",
      padding: 4,
      forceFull: false,
      cursorOn: true,
    });

    expect(fillTextCalls).toEqual([
      ["abx", 4, 15, 21.6],
      ["x", 18.4, 15, 7.2],
    ]);
  });

  it("draws powerline separators as cell-filling shapes between text runs", () => {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]) =>
        calls.push([name, ...args]);
    const context = {
      canvas: { width: 200, height: 40 },
      beginPath: () => {},
      clip: () => {},
      closePath: () => {},
      fill: record("fill"),
      fillRect: () => {},
      fillText: record("fillText"),
      lineTo: record("lineTo"),
      moveTo: record("moveTo"),
      rect: () => {},
      resetTransform: () => {},
      restore: () => {},
      save: () => {},
      fillStyle: "",
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    } as unknown as CanvasRenderingContext2D;
    const cells = [cell("a"), cell("\ue0b0"), cell("b")];
    const snapshot: GhosttySnapshot = {
      cols: 3,
      rows: 1,
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 },
      cursorX: 0,
      cursorY: 0,
      cursorVisible: false,
      cursorBlinking: false,
      cursorStyle: 1,
      dirtyRows: new Set([0]),
      rowData: [{ cells, text: "a\ue0b0b", isWrapContinuation: false, wrapsToNext: false }],
    };

    renderGhosttySnapshot({
      context,
      snapshot,
      metrics: { width: 8, height: 20, baseline: 14 },
      fontSize: 12,
      fontFamily: "monospace",
      padding: 4,
      forceFull: false,
      cursorOn: true,
    });

    // The arrow spans the full 20px cell, not the font's glyph box.
    expect(calls).toEqual([
      ["fillText", "a", 4, 18, 8],
      ["moveTo", 12, 4],
      ["lineTo", 20, 14],
      ["lineTo", 12, 24],
      ["fill"],
      ["fillText", "b", 20, 18, 8],
    ]);
  });

  it("repaints the cell without an overlay during the blink off phase", () => {
    const fillTextCalls: unknown[][] = [];
    const context = {
      canvas: { width: 200, height: 40 },
      beginPath: () => {},
      clip: () => {},
      fillRect: () => {},
      fillText: (...args: unknown[]) => fillTextCalls.push(args),
      rect: () => {},
      resetTransform: () => {},
      restore: () => {},
      save: () => {},
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    } as unknown as CanvasRenderingContext2D;
    const snapshot: GhosttySnapshot = {
      cols: 3,
      rows: 1,
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 },
      cursorX: 2,
      cursorY: 0,
      cursorVisible: true,
      cursorBlinking: true,
      cursorStyle: 1,
      dirtyRows: new Set(),
      rowData: [
        {
          cells: [cell("a"), cell("b"), cell("x")],
          text: "abx",
          isWrapContinuation: false,
          wrapsToNext: false,
        },
      ],
    };

    renderGhosttySnapshot({
      context,
      snapshot,
      metrics: { width: 7.2, height: 16, baseline: 11 },
      fontSize: 12,
      fontFamily: "monospace",
      padding: 4,
      forceFull: false,
      cursorOn: false,
    });

    // The cursor row still repaints so the block disappears, but the inverted
    // glyph the on phase draws over the cell is gone.
    expect(fillTextCalls).toEqual([["abx", 4, 15, 21.6]]);
  });

  it("repaints the previous cursor row after the cursor moves", () => {
    const clearedRows: number[] = [];
    const context = {
      canvas: { width: 200, height: 80 },
      beginPath: () => {},
      clip: () => {},
      fillRect: (_left: number, top: number, _width: number, height: number) => {
        if (height === 16) clearedRows.push(top);
      },
      fillText: () => {},
      rect: () => {},
      resetTransform: () => {},
      restore: () => {},
      save: () => {},
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    } as unknown as CanvasRenderingContext2D;
    const snapshot: GhosttySnapshot = {
      cols: 1,
      rows: 3,
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 },
      cursorX: 0,
      cursorY: 2,
      cursorVisible: true,
      cursorBlinking: false,
      cursorStyle: 1,
      dirtyRows: new Set(),
      rowData: [0, 1, 2].map(() => ({
        cells: [cell("")],
        text: "",
        isWrapContinuation: false,
        wrapsToNext: false,
      })),
    };

    renderGhosttySnapshot({
      context,
      snapshot,
      metrics: { width: 7.2, height: 16, baseline: 11 },
      fontSize: 12,
      fontFamily: "monospace",
      padding: 4,
      forceFull: false,
      cursorOn: true,
      previousCursorY: 0,
    });

    expect(clearedRows).toEqual([4, 36, 36]);
  });
});
