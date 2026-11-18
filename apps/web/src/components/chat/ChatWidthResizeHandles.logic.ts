import { MIN_CHAT_CUSTOM_WIDTH } from "@t3tools/contracts";

/**
 * The chat stays centred, so moving a handle by `deltaX` changes the width by twice that.
 * Works from the pointer's movement, not its distance to the centre: the centre shifts while
 * dragging when the details card moves inline, and chasing it makes the width oscillate.
 */
export function resolveDraggedChatWidth(input: {
  side: "start" | "end";
  startWidth: number;
  deltaX: number;
  availableWidth: number;
}): number {
  const direction = input.side === "end" ? 1 : -1;
  const width = Math.round(input.startWidth + direction * input.deltaX * 2);
  const maxWidth = Math.max(MIN_CHAT_CUSTOM_WIDTH, Math.floor(input.availableWidth));
  return Math.min(maxWidth, Math.max(MIN_CHAT_CUSTOM_WIDTH, width));
}

export function applyChatCustomWidth(root: HTMLElement, width: number | null): void {
  if (width === null) {
    root.style.removeProperty("--chat-content-max-width");
  } else {
    root.style.setProperty("--chat-content-max-width", `${width}px`);
  }
}
