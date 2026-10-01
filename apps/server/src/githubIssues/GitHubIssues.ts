import {
  GITHUB_ISSUE_MARKDOWN_MAX_CHARS,
  GitHubIssueError,
  type GitHubGetIssueInput,
  type GitHubIssueContext,
  type GitHubIssueSummary,
  type GitHubListIssuesInput,
  type GitHubListIssuesResult,
  parseGitHubIssueUrl,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { GitHubCli, type GitHubCliError } from "../sourceControl/GitHubCli.ts";
import { renderGitHubIssueMarkdown } from "./gitHubIssueMarkdown.ts";

const LIST_LIMIT = 50;
const SUMMARY_FIELDS = "number,title,url,state,stateReason,author,assignees,labels,updatedAt";
const DETAIL_FIELDS = `${SUMMARY_FIELDS},body,milestone,comments`;
// `123` or `#123` names an issue in the checkout's repository.
const NUMBER_PATTERN = /^#?(\d+)$/;

const Login = Schema.NullishOr(Schema.Struct({ login: Schema.String }));

const IssueSummaryJson = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  stateReason: Schema.optional(Schema.NullishOr(Schema.String)),
  author: Login,
  assignees: Schema.Array(Schema.Struct({ login: Schema.String })),
  labels: Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String })),
  updatedAt: Schema.String,
});
type IssueSummaryJson = typeof IssueSummaryJson.Type;

const IssueDetailJson = Schema.Struct({
  ...IssueSummaryJson.fields,
  body: Schema.NullishOr(Schema.String),
  milestone: Schema.NullishOr(Schema.Struct({ title: Schema.String })),
  comments: Schema.Array(
    Schema.Struct({
      author: Login,
      authorAssociation: Schema.optional(Schema.String),
      body: Schema.String,
      createdAt: Schema.String,
      isMinimized: Schema.optional(Schema.Boolean),
    }),
  ),
});

const decodeSummary = Schema.decodeUnknownEffect(Schema.fromJsonString(IssueSummaryJson));
const decodeSummaries = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(IssueSummaryJson)),
);
const decodeDetail = Schema.decodeUnknownEffect(Schema.fromJsonString(IssueDetailJson));

/** `NOT_PLANNED` reads as `not planned`; a reopened issue has no reason to show. */
function stateReason(raw: string | null | undefined): string | null {
  if (!raw || raw === "REOPENED") return null;
  return raw.toLowerCase().replaceAll("_", " ");
}

/** The issue's summary, or null when the URL is not an issue (`gh issue view` also finds PRs). */
function toSummary(json: IssueSummaryJson): GitHubIssueSummary | null {
  const parsed = parseGitHubIssueUrl(json.url);
  if (parsed === null) return null;
  return {
    repository: parsed.repository,
    number: json.number,
    title: json.title,
    url: json.url,
    state: json.state.toUpperCase() === "OPEN" ? "open" : "closed",
    stateReason: json.state.toUpperCase() === "OPEN" ? null : stateReason(json.stateReason),
    authorLogin: json.author?.login ?? null,
    assigneeLogins: json.assignees.map((assignee) => assignee.login),
    labels: json.labels.map((label) => ({ name: label.name, color: label.color })),
    updatedAt: json.updatedAt,
  };
}

const notFound = () =>
  new GitHubIssueError({ reason: "not-found", detail: "GitHub issue not found." });

function toIssueError(error: GitHubCliError): GitHubIssueError {
  switch (error._tag) {
    case "GitHubCliUnavailableError":
      return new GitHubIssueError({
        reason: "unavailable",
        detail: "GitHub CLI (`gh`) is required to read GitHub issues.",
        cause: error,
      });
    case "GitHubCliAuthenticationError":
      return new GitHubIssueError({
        reason: "not-authenticated",
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    case "GitHubCliRateLimitError":
      return new GitHubIssueError({
        reason: "rate-limited",
        detail: "GitHub's API rate limit is exhausted. Try again shortly.",
        cause: error,
      });
    case "GitHubPullRequestNotFoundError":
      return notFound();
    default:
      return new GitHubIssueError({
        reason: "api",
        detail: "Could not read GitHub issues. Check that this project's remote is on GitHub.",
        cause: error,
      });
  }
}

const decodeError = (cause: unknown) =>
  new GitHubIssueError({ reason: "api", detail: "GitHub CLI returned unexpected JSON.", cause });

export class GitHubIssues extends Context.Service<
  GitHubIssues,
  {
    readonly listIssues: (
      input: GitHubListIssuesInput,
    ) => Effect.Effect<GitHubListIssuesResult, GitHubIssueError>;
    readonly getIssue: (
      input: GitHubGetIssueInput,
    ) => Effect.Effect<GitHubIssueContext, GitHubIssueError>;
    /** The issue's summary fields alone, for linking and live state. */
    readonly getIssueSummary: (
      input: GitHubGetIssueInput,
    ) => Effect.Effect<GitHubIssueSummary, GitHubIssueError>;
  }
>()("t3/githubIssues/GitHubIssues") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const gh = yield* GitHubCli;

  const run = (cwd: string, args: ReadonlyArray<string>) =>
    gh.execute({ cwd, args }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.mapError(toIssueError),
    );

  // A URL names its repository, so the server's own directory is as good a cwd as any.
  const viewSummary = (cwd: string, reference: string) =>
    run(cwd, ["issue", "view", reference, "--json", SUMMARY_FIELDS]).pipe(
      Effect.flatMap((raw) => decodeSummary(raw).pipe(Effect.mapError(decodeError))),
      Effect.flatMap((json) => {
        const summary = toSummary(json);
        return summary === null ? Effect.fail(notFound()) : Effect.succeed(summary);
      }),
    );

  const listIssues = Effect.fn("github_issues.list")(function* (input: GitHubListIssuesInput) {
    const text = input.query?.trim() ?? "";
    const number = NUMBER_PATTERN.exec(text)?.[1];
    const reference = number ?? (parseGitHubIssueUrl(text) !== null ? text : null);
    if (reference !== null) {
      const issues = yield* viewSummary(input.cwd, reference).pipe(
        Effect.map((summary) => [summary]),
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () => Effect.succeed([]),
        ),
      );
      return { issues };
    }
    const raw = yield* run(input.cwd, [
      "issue",
      "list",
      "--state",
      input.state ?? "open",
      "--limit",
      String(LIST_LIMIT),
      ...(text.length > 0 ? ["--search", text] : []),
      "--json",
      SUMMARY_FIELDS,
    ]);
    const json =
      raw.length === 0 ? [] : yield* decodeSummaries(raw).pipe(Effect.mapError(decodeError));
    return { issues: json.flatMap((issue) => toSummary(issue) ?? []) };
  });

  const getIssue = Effect.fn("github_issues.get")(function* (input: GitHubGetIssueInput) {
    const raw = yield* run(process.cwd(), ["issue", "view", input.url, "--json", DETAIL_FIELDS]);
    const json = yield* decodeDetail(raw).pipe(Effect.mapError(decodeError));
    const summary = toSummary(json);
    if (summary === null) return yield* notFound();
    const markdown = renderGitHubIssueMarkdown(
      {
        ...summary,
        body: json.body ?? "",
        labels: summary.labels.map((label) => label.name),
        milestone: json.milestone?.title ?? null,
        comments: json.comments.map((comment) => ({
          authorLogin: comment.author?.login ?? null,
          authorAssociation: comment.authorAssociation ?? "NONE",
          body: comment.body,
          createdAt: comment.createdAt,
          isMinimized: comment.isMinimized ?? false,
        })),
      },
      GITHUB_ISSUE_MARKDOWN_MAX_CHARS,
    );
    return { ...summary, markdown } satisfies GitHubIssueContext;
  });

  const getIssueSummary = Effect.fn("github_issues.get_summary")(function* (
    input: GitHubGetIssueInput,
  ) {
    return yield* viewSummary(process.cwd(), input.url);
  });

  return GitHubIssues.of({ listIssues, getIssue, getIssueSummary });
});

export const layer = Layer.effect(GitHubIssues, make);
