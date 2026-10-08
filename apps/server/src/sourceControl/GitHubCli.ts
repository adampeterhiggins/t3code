import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { VcsError } from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubApi from "./GitHubApi.ts";
import * as GitHubCredentials from "./GitHubCredentials.ts";

const gitHubCliFailureFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubCliUnavailableError extends Schema.TaggedError<GitHubCliUnavailableError>()(
  "GitHubCliUnavailableError",
  gitHubCliFailureFields,
) {
  override get message(): string {
    return "No GitHub credential on the server. Set GH_TOKEN, or install the GitHub CLI and run `gh auth login`.";
  }
}

export class GitHubCliAuthenticationError extends Schema.TaggedError<GitHubCliAuthenticationError>()(
  "GitHubCliAuthenticationError",
  gitHubCliFailureFields,
) {
  override get message(): string {
    // A missing or turned-off credential already says what to do about it.
    return Schema.is(
      Schema.Union([
        GitHubCredentials.GitHubNotSignedInError,
        GitHubCredentials.GitHubHostDisabledError,
      ]),
    )(this.cause)
      ? this.cause.message
      : "GitHub is not authenticated. Run `gh auth login` (or set GH_TOKEN) and retry.";
  }
}

export class GitHubCliRateLimitError extends Schema.TaggedError<GitHubCliRateLimitError>()(
  "GitHubCliRateLimitError",
  { ...gitHubCliFailureFields, retryAt: Schema.optionalKey(Schema.Finite) },
) {
  override get message(): string {
    return "GitHub API rate limit exceeded. Requests resume when the limit resets.";
  }
}

export class GitHubPullRequestNotFoundError extends Schema.TaggedError<GitHubPullRequestNotFoundError>()(
  "GitHubPullRequestNotFoundError",
  gitHubCliFailureFields,
) {
  override get message(): string {
    return "Pull request not found. Check the PR number or URL and try again.";
  }
}

export class GitHubCliCommandError extends Schema.TaggedError<GitHubCliCommandError>()(
  "GitHubCliCommandError",
  { ...gitHubCliFailureFields, httpStatus: Schema.optional(Schema.Int) },
) {
  override get message(): string {
    // GitHub's own reason ("A pull request already exists…") or the failed step's, when known.
    const reason =
      this.cause instanceof Error && this.cause.message.trim() !== ""
        ? this.cause.message.trim()
        : null;
    return reason === null ? "GitHub request failed." : reason;
  }
}

export const GitHubCliError = Schema.Union([
  GitHubCliUnavailableError,
  GitHubCliAuthenticationError,
  GitHubCliRateLimitError,
  GitHubPullRequestNotFoundError,
  GitHubCliCommandError,
]);
export type GitHubCliError = typeof GitHubCliError.Type;

export const isGitHubCliError = Schema.is(GitHubCliError);

export function fromVcsError(
  context: {
    readonly command: "gh";
    readonly cwd: string;
  },
  error: VcsError,
): GitHubCliError {
  if (
    error._tag === "VcsProcessSpawnError" &&
    error.cause instanceof PlatformError.PlatformError &&
    error.cause.reason._tag === "NotFound" &&
    error.cause.reason.module === "ChildProcess" &&
    error.cause.reason.method === "spawn"
  ) {
    return new GitHubCliUnavailableError({ ...context, cause: error });
  }

  if (error._tag === "VcsProcessExitError") {
    if (error.failureKind === "authentication") {
      return new GitHubCliAuthenticationError({ ...context, cause: error });
    }
    if (error.failureKind === "rate-limited") {
      return new GitHubCliRateLimitError({ ...context, cause: error });
    }
    if (error.failureKind === "not-found") {
      return new GitHubPullRequestNotFoundError({ ...context, cause: error });
    }
  }

  return new GitHubCliCommandError({ ...context, cause: error });
}

/** Maps a GitHub API failure onto the errors callers of this service already handle. */
function fromGitHubApiError(cwd: string, error: GitHubApi.GitHubApiError): GitHubCliError {
  const context = { command: "gh" as const, cwd, cause: error };
  switch (error._tag) {
    case "GitHubCliMissingError":
      return new GitHubCliUnavailableError(context);
    case "GitHubNotSignedInError":
    case "GitHubHostDisabledError":
    case "GitHubApiAuthenticationError":
      return new GitHubCliAuthenticationError(context);
    case "GitHubCliFailedError":
      return new GitHubCliCommandError(context);
    case "GitHubApiRateLimitError":
      return new GitHubCliRateLimitError({
        ...context,
        ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
      });
    case "SourceControlRateLimitPausedError":
      return new GitHubCliRateLimitError({ ...context, retryAt: error.retryAt });
    case "GitHubApiNotFoundError":
      return new GitHubPullRequestNotFoundError(context);
    case "GitHubApiResponseError":
      return new GitHubCliCommandError({ ...context, httpStatus: error.status });
    case "GitHubApiRequestError":
      return new GitHubCliCommandError(context);
  }
}

/** Fork issue and repository context use gh's JSON projections. PRs use SourceControlProvider. */
export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
    }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;
  }
>()("t3/sourceControl/GitHubCli") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;
  const environment = yield* HostProcessEnvironment;
  const api = yield* GitHubApi.GitHubApi;
  const execute: GitHubCli["Service"]["execute"] = Effect.fn("GitHubCli.execute")(
    function* (input) {
      // Resolve the credential through the same per-host settings as upstream's API reads.
      const reference = input.args[2];
      const host = reference?.startsWith("https://")
        ? new URL(reference).host
        : (environment.GH_HOST ?? "github.com");
      const credential = yield* api
        .credential(host)
        .pipe(Effect.mapError((error) => fromGitHubApiError(input.cwd, error)));
      const token = Redacted.value(credential.token);
      return yield* process
        .run({
          operation: "GitHubCli.execute",
          command: "gh",
          args: input.args,
          cwd: input.cwd,
          timeoutMs: 30_000,
          env: {
            GH_HOST: host,
            GH_TOKEN: token,
            GITHUB_TOKEN: token,
            GH_ENTERPRISE_TOKEN: token,
            GITHUB_ENTERPRISE_TOKEN: token,
            GH_DEBUG: "",
          },
        })
        .pipe(Effect.mapError((cause) => fromVcsError({ command: "gh", cwd: input.cwd }, cause)));
    },
  );

  return GitHubCli.of({ execute });
});

export const layer = Layer.effect(GitHubCli, make).pipe(
  Layer.provide(GitHubApi.layerWithDependencies),
);
