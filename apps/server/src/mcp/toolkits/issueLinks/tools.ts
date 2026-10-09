import {
  GitHubIssueError,
  GitHubIssueThreadLink,
  GitHubIssueUrl,
  LinearError,
  LinearThreadLink,
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as GitHubIssueThreadLinks from "../../../githubIssues/GitHubIssueThreadLinks.ts";
import * as LinearThreadLinks from "../../../linear/LinearThreadLinks.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  LinearThreadLinks.LinearThreadLinks,
  GitHubIssueThreadLinks.GitHubIssueThreadLinks,
];

const ONE_PER_THREAD =
  "A thread (with its chat tabs) links at most one Linear issue and one GitHub issue; linking another replaces the current one.";

const threadIdParameter = Schema.optional(
  ThreadId.annotate({ description: "Thread to act on. Omit for this thread." }),
);

export class IssueLinkThreadRequiredError extends Schema.TaggedError<IssueLinkThreadRequiredError>()(
  "IssueLinkThreadRequiredError",
  {},
) {
  override get message(): string {
    return "Pass threadId: this MCP client is not running inside a T3 thread.";
  }
}

export class IssueLinkThreadNotFoundError extends Schema.TaggedError<IssueLinkThreadNotFoundError>()(
  "IssueLinkThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export const IssueLinkToolError = Schema.Union([
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  IssueLinkThreadRequiredError,
  IssueLinkThreadNotFoundError,
  LinearError,
  GitHubIssueError,
]);
export type IssueLinkToolError = typeof IssueLinkToolError.Type;

const replacedUrl = Schema.NullOr(Schema.String).annotate({
  description: "URL of a different issue this link replaced, or null.",
});

export const LinkLinearIssueResult = Schema.Struct({
  link: LinearThreadLink,
  replacedUrl,
});
export type LinkLinearIssueResult = typeof LinkLinearIssueResult.Type;

export const LinkGitHubIssueResult = Schema.Struct({
  link: GitHubIssueThreadLink,
  replacedUrl,
});
export type LinkGitHubIssueResult = typeof LinkGitHubIssueResult.Type;

export const UnlinkIssueResult = Schema.Struct({
  wasLinked: Schema.Boolean.annotate({
    description: "False when the thread had no such issue linked to begin with.",
  }),
});
export type UnlinkIssueResult = typeof UnlinkIssueResult.Type;

export const ListThreadIssuesResult = Schema.Struct({
  linear: Schema.NullOr(LinearThreadLink),
  github: Schema.NullOr(GitHubIssueThreadLink),
});
export type ListThreadIssuesResult = typeof ListThreadIssuesResult.Type;

const LinkLinearIssueTool = Tool.make("link_linear_issue", {
  description: `Link a Linear issue to a thread so T3 Code shows it beside the thread with its live status. ${ONE_PER_THREAD} Needs the user's Linear connection.`,
  parameters: Schema.Struct({
    threadId: threadIdParameter,
    issue: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)).annotate({
      description: "The issue's identifier such as ENG-123, its UUID, or its linear.app URL.",
    }),
  }),
  success: LinkLinearIssueResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link Linear issue to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const UnlinkLinearIssueTool = Tool.make("unlink_linear_issue", {
  description:
    "Remove the Linear issue link from a thread. Unlinking when none is linked succeeds with wasLinked=false.",
  parameters: Schema.Struct({ threadId: threadIdParameter }),
  success: UnlinkIssueResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink Linear issue from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const LinkGitHubIssueTool = Tool.make("link_github_issue", {
  description: `Link a GitHub issue to a thread so T3 Code shows it beside the thread with its live state. ${ONE_PER_THREAD} For pull requests use link_pull_request instead.`,
  parameters: Schema.Struct({
    threadId: threadIdParameter,
    url: GitHubIssueUrl.annotate({
      description: "The issue's web URL, for example https://github.com/owner/repo/issues/123.",
    }),
  }),
  success: LinkGitHubIssueResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link GitHub issue to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const UnlinkGitHubIssueTool = Tool.make("unlink_github_issue", {
  description:
    "Remove the GitHub issue link from a thread. Unlinking when none is linked succeeds with wasLinked=false.",
  parameters: Schema.Struct({ threadId: threadIdParameter }),
  success: UnlinkIssueResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink GitHub issue from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListThreadIssuesTool = Tool.make("list_thread_issues", {
  description: `Read the Linear and GitHub issues linked to a thread (omit threadId for this thread); null where none is linked. ${ONE_PER_THREAD} For pull requests use list_thread_pull_requests.`,
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Thread to read. Omit for this thread." }),
    ),
  }),
  success: ListThreadIssuesResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "List thread issues")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const IssueLinksToolkit = Toolkit.make(
  LinkLinearIssueTool,
  UnlinkLinearIssueTool,
  LinkGitHubIssueTool,
  UnlinkGitHubIssueTool,
  ListThreadIssuesTool,
);
