import { MIN_CHAT_CUSTOM_WIDTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveDraggedChatWidth } from "./ChatWidthResizeHandles.logic";

describe("resolveDraggedChatWidth", () => {
  it.each([
    { name: "right of centre", pointerX: 900, expected: 800 },
    { name: "left of centre", pointerX: 100, expected: 800 },
    { name: "below the minimum", pointerX: 510, expected: MIN_CHAT_CUSTOM_WIDTH },
    { name: "past the available width", pointerX: 1400, expected: 1000 },
  ])("sizes symmetrically from the centre when $name", ({ pointerX, expected }) => {
    expect(resolveDraggedChatWidth({ pointerX, centerX: 500, availableWidth: 1000 })).toBe(
      expected,
    );
  });
});
