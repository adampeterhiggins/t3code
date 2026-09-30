import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadPullRequestKey } from "./orchestration.ts";

export const PullRequestWatchStatus = Schema.Literals(["active", "paused"]);
export type PullRequestWatchStatus = typeof PullRequestWatchStatus.Type;

/**
 * A thread's standing instruction to follow one linked pull request: when the host reports work
 * for the agent (failing checks, requested changes, conflicts), the server starts a follow-up turn.
 */
export const PullRequestWatch = Schema.Struct({
  threadId: ThreadId,
  ...ThreadPullRequestKey.fields,
  status: PullRequestWatchStatus,
  /** Follow-up turns started since the watch began or last resumed. */
  attemptsUsed: NonNegativeInt,
  /** Problem keys the last follow-up was started for; they do not wake the agent again. */
  handled: Schema.Array(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type PullRequestWatch = typeof PullRequestWatch.Type;

export const PullRequestWatches = Schema.Array(PullRequestWatch);
export type PullRequestWatches = typeof PullRequestWatches.Type;

export const PullRequestWatchAction = Schema.Literals(["watch", "pause", "resume", "stop"]);
export type PullRequestWatchAction = typeof PullRequestWatchAction.Type;

export const SetPullRequestWatchInput = Schema.Struct({
  ...ThreadPullRequestKey.fields,
  action: PullRequestWatchAction,
});
export type SetPullRequestWatchInput = typeof SetPullRequestWatchInput.Type;
