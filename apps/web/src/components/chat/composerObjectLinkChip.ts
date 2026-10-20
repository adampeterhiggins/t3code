import { locateComposerObjectLink } from "@t3tools/shared/composerObjectLinks";

import {
  type ComposerContextReference,
  inlineContextReferenceReplacement,
} from "~/lib/composerContextReferences";

/**
 * The drafts a link conversion sees. `workKey` is the draft holding the text being edited: the
 * question's answer draft while one is open, otherwise the composer draft itself.
 */
export interface ObjectLinkDrafts {
  readonly draftKey: string;
  readonly workKey: string;
}

/**
 * Where a link's chip goes once its object loads, which can be long after the paste.
 * - `editor`: the text it was pasted into is still on screen.
 * - `stored-draft`: it was pasted into the composer draft, which is no longer the one on screen
 *   (another thread is open, a question took over the composer, the composer unmounted). The
 *   draft still holds the link, so the chip goes there.
 * - `drop`: it was pasted into a question's answer that has since closed.
 */
export function objectLinkChipDestination(
  started: ObjectLinkDrafts,
  now: ObjectLinkDrafts | null,
): "editor" | "stored-draft" | "drop" {
  if (now !== null && now.draftKey === started.draftKey && now.workKey === started.workKey) {
    return "editor";
  }
  return started.workKey === started.draftKey ? "stored-draft" : "drop";
}

/** The edit swapping `url` for `reference` in `prompt`, or null once the link was edited away. */
export function objectLinkChipEdit(
  prompt: string,
  url: string,
  hint: number,
  reference: ComposerContextReference,
): { readonly start: number; readonly end: number; readonly text: string } | null {
  const range = locateComposerObjectLink(prompt, url, hint);
  return range === null ? null : inlineContextReferenceReplacement(prompt, range, [reference]);
}
