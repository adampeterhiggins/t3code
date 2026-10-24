import type { ThreadId, UnreadLinkContextRecord } from "@t3tools/contracts";
import {
  type ComposerObjectLink,
  locateComposerObjectLink,
} from "@t3tools/source-control-definitions/composerObjectLinks";
import { unreadLinkContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";

import { useIssueContextStore } from "~/issueContextStore";
import {
  type ComposerContextReference,
  inlineContextReferenceReplacement,
} from "~/lib/composerContextReferences";
import type { ResolvedComposerObjectLink } from "./useResolveComposerObjectLink";

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

/**
 * How long a link may take to load before its chip shows it failed. A pull request comment can
 * take a few reads of the host, so this is generous; a link that needs longer can be retried.
 */
export const OBJECT_LINK_TIMEOUT_MS = 20_000;

/** `resolving`, or `timed-out` once `timeoutMs` passes first. A loader that throws is unreadable. */
export function resolveObjectLinkWithin<A>(
  resolving: Promise<A>,
  timeoutMs: number,
): Promise<A | "timed-out" | "unreadable"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  return Promise.race([resolving.catch((): "unreadable" => "unreadable"), timedOut]).finally(() =>
    clearTimeout(timer),
  );
}

/** The broken chip for a link that was tried and could not be read. */
export function unreadLinkChip(
  threadId: ThreadId,
  link: ComposerObjectLink,
  reason: UnreadLinkContextRecord["reason"],
): ResolvedComposerObjectLink {
  const record = unreadLinkContextRecord(link, reason);
  return {
    reference: { kind: record.kind, contextId: record.contextId, label: record.label },
    commit: () => useIssueContextStore.getState().upsert(threadId, record),
  };
}
