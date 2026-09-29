import type { ScopedThreadRef } from "@t3tools/contracts";
import { createContext, useContext } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";

/**
 * What a pull request detail knows about where it is shown: the repository its body's short
 * references resolve against, and the thread it sits beside, if any. Kept apart from the
 * markdown renderer so presentation pieces can read it without importing chat markdown.
 */
export const PullRequestMarkdownContext = createContext<{
  repositoryUrl: string | null;
  threadRef: ScopedThreadRef | null;
} | null>(null);

/**
 * Opens a host link from a pull request detail where "Open links in" says: beside `threadRef`
 * when given, otherwise beside the thread the surrounding detail is shown with.
 */
export function usePullRequestLinkClick(threadRef?: ScopedThreadRef | null) {
  const contextThreadRef = useContext(PullRequestMarkdownContext)?.threadRef ?? null;
  return useLinkClickHandler(threadRef ?? contextThreadRef);
}
