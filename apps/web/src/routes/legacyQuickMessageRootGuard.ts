import { redirect } from "@tanstack/react-router";

const LEGACY_QUICK_MESSAGE_PATH = "/quick-message";

/**
 * The legacy quick-message window shares the main profile. Root `beforeLoad`
 * is the last hook that runs before a child route mounts ChatView, which writes
 * drafts. Call this before pair, auth, and snapshot resume. An isolated window
 * is a different session and keeps the route it opened.
 */
export function redirectLegacyQuickMessageWindow(input: {
  readonly isQuickMessageWindow: boolean;
  readonly isDetachedChatWindow: boolean;
  readonly pathname: string;
}): void {
  if (
    input.isQuickMessageWindow &&
    !input.isDetachedChatWindow &&
    input.pathname !== LEGACY_QUICK_MESSAGE_PATH
  ) {
    throw redirect({ to: LEGACY_QUICK_MESSAGE_PATH, replace: true });
  }
}
