import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Context repositories: other repositories cloned into a workspace's context
 * directory (`.context/` by default) so an agent can read their source. A
 * message carries them as `repository` context records; the server clones
 * whatever is missing before the turn starts and writes the outcome back onto
 * the record, so the chip and the agent both see what happened.
 */

export const CONTEXT_REPOSITORY_DETAIL_MAX_CHARS = 2_000;
export const DEFAULT_CONTEXT_REPOSITORY_DIRECTORY = ".context";

const ShortString = Schema.String.check(Schema.isMaxLength(2_048));

/**
 * One path segment: the clone's folder under the context directory. No
 * separators and no dot-only names, so it can never escape that directory.
 */
export const ContextRepositoryDirectoryName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(255),
  Schema.isPattern(/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/),
);
export type ContextRepositoryDirectoryName = typeof ContextRepositoryDirectoryName.Type;

/** A clone's git state as last read. `branch` is null on a detached HEAD. */
export const ContextRepositoryGitStatus = Schema.Struct({
  branch: Schema.NullOr(ShortString),
  headSha: Schema.NullOr(ShortString),
  upstream: Schema.NullOr(ShortString),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  changedFiles: NonNegativeInt,
});
export type ContextRepositoryGitStatus = typeof ContextRepositoryGitStatus.Type;

/**
 * What the server did for one attached repository before the turn:
 * - `cloned`: it was missing and is now cloned.
 * - `present`: a clone of the same remote was already there and was left alone.
 * - `conflict`: the folder exists but is not a clone of this remote; untouched.
 * - `failed`: the clone was attempted and failed.
 */
export const ContextRepositoryOutcomeStatus = Schema.Literals([
  "cloned",
  "present",
  "conflict",
  "failed",
]);
export type ContextRepositoryOutcomeStatus = typeof ContextRepositoryOutcomeStatus.Type;

export const ContextRepositoryOutcome = Schema.Struct({
  status: ContextRepositoryOutcomeStatus,
  /** Workspace-relative path of the clone, e.g. `.context/api`. */
  path: ShortString,
  detail: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(CONTEXT_REPOSITORY_DETAIL_MAX_CHARS)),
  ),
  git: Schema.NullOr(ContextRepositoryGitStatus),
  /** Whether `ahead`/`behind` reflect a fetch made just now rather than the last one. */
  fetched: Schema.Boolean,
});
export type ContextRepositoryOutcome = typeof ContextRepositoryOutcome.Type;

/** A repository the picker can offer. */
export const ContextRepositoryCandidate = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  pushedAt: Schema.NullOr(Schema.String),
  isPrivate: Schema.Boolean,
});
export type ContextRepositoryCandidate = typeof ContextRepositoryCandidate.Type;

/** A GitHub org or user whose repositories the picker lists. */
export const ContextRepositoryOwner = TrimmedNonEmptyString.check(Schema.isMaxLength(255));
export const MAX_CONTEXT_REPOSITORY_OWNERS = 20;
/** Owners in priority order: the picker lists the first owner's repositories first. */
export const ContextRepositoryOwners = Schema.Array(ContextRepositoryOwner).check(
  Schema.isMaxLength(MAX_CONTEXT_REPOSITORY_OWNERS),
);

export const ContextRepositoryListInput = Schema.Struct({
  /** The first owner. A server older than `owners` lists only this one. */
  owner: ContextRepositoryOwner,
  /** Every owner to list, in priority order. Lists `owner` alone when absent. */
  owners: Schema.optional(ContextRepositoryOwners),
  /** Per owner. */
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(1_000))),
});
export type ContextRepositoryListInput = typeof ContextRepositoryListInput.Type;

export const ContextRepositoryListResult = Schema.Struct({
  repositories: Schema.Array(ContextRepositoryCandidate),
});
export type ContextRepositoryListResult = typeof ContextRepositoryListResult.Type;

/** A clone already sitting in a workspace's context directory. */
export const ContextRepositoryClone = Schema.Struct({
  directoryName: ContextRepositoryDirectoryName,
  /** The clone's `origin`, credentials stripped; null when it has none. */
  remoteUrl: Schema.NullOr(ShortString),
  git: Schema.NullOr(ContextRepositoryGitStatus),
});
export type ContextRepositoryClone = typeof ContextRepositoryClone.Type;

export const ContextRepositoryInspectInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ContextRepositoryInspectInput = typeof ContextRepositoryInspectInput.Type;

export const ContextRepositoryInspectResult = Schema.Struct({
  /** Workspace-relative context directory, e.g. `.context`. */
  directory: ShortString,
  clones: Schema.Array(ContextRepositoryClone),
});
export type ContextRepositoryInspectResult = typeof ContextRepositoryInspectResult.Type;

export class ContextRepositoryError extends Schema.TaggedError<ContextRepositoryError>()(
  "ContextRepositoryError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * Normalizes a remote for "is this the same repository" checks: scheme,
 * credentials, `.git`, and case-insensitive hosts do not matter, so
 * `git@github.com:Org/Api.git` and `https://github.com/org/api` match.
 */
export function contextRepositoryRemoteKey(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  let hostAndPath: string;
  if (scp) {
    hostAndPath = `${scp[1]}/${scp[2]}`;
  } else {
    try {
      const url = new URL(trimmed);
      hostAndPath = `${url.host}${url.pathname}`;
    } catch {
      hostAndPath = trimmed;
    }
  }
  return hostAndPath
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}
