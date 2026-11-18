import { MIN_CHAT_CUSTOM_WIDTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveDraggedChatWidth } from "./ChatWidthResizeHandles.logic";

describe("resolveDraggedChatWidth", () => {
  it.each([
    { name: "the end handle moves right", side: "end", deltaX: 50, expected: 900 },
    { name: "the start handle moves left", side: "start", deltaX: -50, expected: 900 },
    { name: "the start handle moves right", side: "start", deltaX: 50, expected: 700 },
    {
      name: "it goes below the minimum",
      side: "end",
      deltaX: -300,
      expected: MIN_CHAT_CUSTOM_WIDTH,
    },
    { name: "it goes past the available width", side: "end", deltaX: 400, expected: 1000 },
  ] as const)("grows both sides when $name", ({ side, deltaX, expected }) => {
    expect(resolveDraggedChatWidth({ side, startWidth: 800, deltaX, availableWidth: 1000 })).toBe(
      expected,
    );
  });
});
