import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { PullRequestState } from "./pullRequest.ts";

/**
 * Where a worktree's threads stand. A worktree takes the liveliest state of its
 * threads: active, then settled, then archived; `none` when no thread uses it.
 */
export const ManagedWorktreeThreadState = Schema.Literals(["active", "settled", "archived"]);
export type ManagedWorktreeThreadState = typeof ManagedWorktreeThreadState.Type;

export const ManagedWorktreeState = Schema.Literals(["active", "settled", "archived", "none"]);
export type ManagedWorktreeState = typeof ManagedWorktreeState.Type;

export const ManagedWorktreeThread = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  state: ManagedWorktreeThreadState,
  /** A turn, approval, queued message, or background task is still in flight. */
  running: Schema.Boolean,
});
export type ManagedWorktreeThread = typeof ManagedWorktreeThread.Type;

export const ManagedWorktreePullRequest = Schema.Struct({
  number: PositiveInt,
  url: TrimmedNonEmptyString,
  /** Last synced host state; null until the pull request has been synced. */
  state: Schema.NullOr(PullRequestState),
});
export type ManagedWorktreePullRequest = typeof ManagedWorktreePullRequest.Type;

/** A git worktree under one of the environment's worktree folders. Sizes load separately. */
export const ManagedWorktree = Schema.Struct({
  path: TrimmedNonEmptyString,
  /** The `<repository>` folder the worktree sits in. */
  repositoryName: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  branch: Schema.NullOr(Schema.String),
  /** Uncommitted or untracked changes; null when git could not read the checkout. */
  dirty: Schema.NullOr(Schema.Boolean),
  state: ManagedWorktreeState,
  threads: Schema.Array(ManagedWorktreeThread),
  pullRequest: Schema.NullOr(ManagedWorktreePullRequest),
});
export type ManagedWorktree = typeof ManagedWorktree.Type;

export const WorktreeInventoryListResult = Schema.Struct({
  worktrees: Schema.Array(ManagedWorktree),
});
export type WorktreeInventoryListResult = typeof WorktreeInventoryListResult.Type;

export const WorktreeInventorySizeInput = Schema.Struct({ path: TrimmedNonEmptyString });
export type WorktreeInventorySizeInput = typeof WorktreeInventorySizeInput.Type;

export const WorktreeInventorySizeResult = Schema.Struct({
  /** Null when the path is not a managed worktree or its size could not be measured. */
  bytes: Schema.NullOr(NonNegativeInt),
});
export type WorktreeInventorySizeResult = typeof WorktreeInventorySizeResult.Type;

export const WorktreeInventoryRemoveInput = Schema.Struct({
  paths: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});
export type WorktreeInventoryRemoveInput = typeof WorktreeInventoryRemoveInput.Type;

/**
 * `dirty` and `running` are safety refusals. `not_managed`
 * covers anything that is not a linked worktree under a worktree folder, such
 * as a project's own checkout.
 */
export const WorktreeRemoveOutcome = Schema.Literals([
  "removed",
  "dirty",
  "running",
  "not_managed",
  "failed",
]);
export type WorktreeRemoveOutcome = typeof WorktreeRemoveOutcome.Type;

export const WorktreeInventoryRemoveResult = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      outcome: WorktreeRemoveOutcome,
    }),
  ),
});
export type WorktreeInventoryRemoveResult = typeof WorktreeInventoryRemoveResult.Type;

export class WorktreeInventoryListError extends Schema.TaggedError<WorktreeInventoryListError>()(
  "WorktreeInventoryListError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "Could not list worktrees.";
  }
}
