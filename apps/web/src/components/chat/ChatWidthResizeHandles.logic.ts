import { MIN_CHAT_CUSTOM_WIDTH } from "@t3tools/contracts";

/** The chat stays centred, so a handle's distance from the centre is half the width. */
export function resolveDraggedChatWidth(input: {
  pointerX: number;
  centerX: number;
  availableWidth: number;
}): number {
  const width = Math.round(Math.abs(input.pointerX - input.centerX) * 2);
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
