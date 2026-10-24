import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Fork: the kinds of link a thread's tab group holds at most one of each. */
export const ThreadLinkKind = Schema.Literals([
  "linear",
  "github",
  "slack",
  "discord",
  "notion",
  "google",
  "granola",
]);
export type ThreadLinkKind = typeof ThreadLinkKind.Type;

/**
 * Fork: a thread waiting on one of its tab group's links. T3 Code reads the linked object on a
 * schedule and wakes the thread's agent when it changes. Unlinking or replacing the link, or
 * archiving the thread, ends the watch.
 */
export const ThreadLinkWatch = Schema.Struct({
  threadId: ThreadId,
  kind: ThreadLinkKind,
  /** The link the watch started on; a different link of the same kind ends it. */
  url: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
  /** Wakes so far. Watching stops at a limit, so a busy conversation cannot loop it. */
  wakes: NonNegativeInt,
});
export type ThreadLinkWatch = typeof ThreadLinkWatch.Type;

export const ThreadLinkWatches = Schema.Array(ThreadLinkWatch);
export type ThreadLinkWatches = typeof ThreadLinkWatches.Type;

export const ThreadLinkWatchSetInput = Schema.Struct({
  threadId: ThreadId,
  kind: ThreadLinkKind,
  watching: Schema.Boolean,
});
export type ThreadLinkWatchSetInput = typeof ThreadLinkWatchSetInput.Type;

export const ThreadLinkWatchErrorReason = Schema.Literals([
  "not-linked",
  "thread-unavailable",
  "unreadable",
  "storage",
]);
export type ThreadLinkWatchErrorReason = typeof ThreadLinkWatchErrorReason.Type;

export class ThreadLinkWatchError extends Schema.TaggedError<ThreadLinkWatchError>()(
  "ThreadLinkWatchError",
  {
    reason: ThreadLinkWatchErrorReason,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
