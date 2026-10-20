import type { DesktopQuickMessageAttachment } from "@t3tools/contracts";
import { createContext, useContext } from "react";

/**
 * Set by the quick message panel, whose attach pickers hand each pick back instead of attaching
 * it: the panel has no draft of its own, and its stores share the main window's storage. The
 * main window attaches the picks to the new draft when the message is sent.
 */
export const ComposerAttachRedirect = createContext<
  ((attachment: DesktopQuickMessageAttachment) => void) | null
>(null);

export function useComposerAttachRedirect() {
  return useContext(ComposerAttachRedirect);
}
