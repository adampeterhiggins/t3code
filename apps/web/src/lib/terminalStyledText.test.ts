import { describe, expect, it } from "vite-plus/test";

import { parseTerminalStyledText, resolveTerminalTextColor } from "./terminalStyledText";

describe("parseTerminalStyledText", () => {
  it("splits text into runs at SGR changes and resets", () => {
    const runs = parseTerminalStyledText("\x1b[1;31merror:\x1b[0m done");
    expect(runs.map((run) => run.text)).toEqual(["error:", " done"]);
    expect(runs[0]!.style).toMatchObject({
      bold: true,
      foreground: { kind: "palette", index: 1 },
    });
    expect(runs[1]!.style).toMatchObject({ bold: false, foreground: null });
  });

  it("reads bright, 256-color and truecolor forms in both separators", () => {
    const [bright, indexed, rgb, colon] = parseTerminalStyledText(
      "\x1b[92ma\x1b[38;5;208mb\x1b[48;2;10;20;30mc\x1b[38:2::1:2:3md",
    );
    expect(bright!.style.foreground).toEqual({ kind: "palette", index: 10 });
    expect(indexed!.style.foreground).toEqual({ kind: "palette", index: 208 });
    expect(rgb!.style.background).toEqual({ kind: "rgb", r: 10, g: 20, b: 30 });
    expect(colon!.style.foreground).toEqual({ kind: "rgb", r: 1, g: 2, b: 3 });
  });

  it("drops non-SGR sequences such as OSC 8 hyperlinks and cursor moves", () => {
    const runs = parseTerminalStyledText(
      "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\x1b[2K line\x07",
    );
    expect(runs.map((run) => run.text).join("")).toBe("link line\x07");
  });
});

describe("resolveTerminalTextColor", () => {
  const palette = Array.from({ length: 16 }, (_, index) => ({ r: index, g: index, b: index }));

  it("uses the theme for the first 16 slots and the xterm cube above them", () => {
    expect(resolveTerminalTextColor({ kind: "palette", index: 3 }, palette)).toBe("rgb(3 3 3)");
    expect(resolveTerminalTextColor({ kind: "palette", index: 196 }, palette)).toBe("rgb(255 0 0)");
    expect(resolveTerminalTextColor({ kind: "palette", index: 244 }, palette)).toBe(
      "rgb(128 128 128)",
    );
  });
});
