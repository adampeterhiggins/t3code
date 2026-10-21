import {
  GitHubIssueError,
  GitHubIssueThreadLink,
  GitHubIssueUrl,
  LinearError,
  LinearFilterOptions,
  LinearIssueContext,
  LinearIssueFilters,
  LinearIssueSort,
  LinearListIssuesResult,
  LinearThreadLink,
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as GitHubIssueThreadLinks from "../../../githubIssues/GitHubIssueThreadLinks.ts";
import * as LinearApi from "../../../linear/LinearApi.ts";
import * as LinearThreadLinks from "../../../linear/LinearThreadLinks.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  LinearThreadLinks.LinearThreadLinks,
  GitHubIssueThreadLinks.GitHubIssueThreadLinks,
  LinearApi.LinearApi,
];

// Agents often have no Linear MCP server of their own, or one that is not authorised.
const T3_LINEAR_CONNECTION =
  "Uses T3 Code's own Linear connection (Settings > Integrations > Linear), so it works without a Linear MCP server.";

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

export class NoLinkedLinearIssueError extends Schema.TaggedError<NoLinkedLinearIssueError>()(
  "NoLinkedLinearIssueError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} has no linked Linear issue. Pass issue to read a specific one.`;
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
  NoLinkedLinearIssueError,
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
  description: `Link a Linear issue to a thread so T3 Code shows it beside the thread with its live status. ${ONE_PER_THREAD} Returns only the issue's identity; use read_linear_issue for its contents. ${T3_LINEAR_CONNECTION}`,
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
  description: `Read the Linear and GitHub issues linked to a thread (omit threadId for this thread); null where none is linked. Returns only each issue's identity: use read_linear_issue for a Linear issue's description, comments, and status. ${ONE_PER_THREAD} For pull requests use list_thread_pull_requests.`,
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

const ReadLinearIssueTool = Tool.make("read_linear_issue", {
  description: `Read a Linear issue in full: status, priority, assignee, team, project, labels, parent, sub-issues, attached links, description, and comments, as markdown. Omit issue to read the issue linked to the thread. Long issues are trimmed, oldest comments first. ${T3_LINEAR_CONNECTION}`,
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({
        description:
          "Thread whose linked issue to read when issue is omitted. Omit for this thread.",
      }),
    ),
    issue: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)).annotate({
        description: "The issue's identifier such as ENG-123, its UUID, or its linear.app URL.",
      }),
    ),
  }),
  success: LinearIssueContext,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read Linear issue")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const LinearFilterValuesDescription = {
  assigneeIds: "User ids, or me and none.",
  teamIds: "Team ids.",
  projectIds: "Project ids, or none.",
  milestoneIds: "Project milestone ids.",
  stateNames: "Status names such as In Progress.",
  priorities: "0 none, 1 urgent, 2 high, 3 medium, 4 low.",
  labelNames: "Label names.",
  includeClosed: "Include completed and canceled issues when stateNames is empty. Default false.",
} satisfies Record<keyof typeof LinearIssueFilters.fields, string>;

const SearchLinearIssuesTool = Tool.make("search_linear_issues", {
  description: `Find Linear issues. An identifier or issue URL in query looks that issue up; other text runs Linear's relevance-ranked search (limited to 30 searches a minute). With neither query nor filters, lists the user's open assigned issues. Each list in filters narrows the results; get ids from list_linear_filter_options. Returns up to 50 summaries; use read_linear_issue for an issue's contents. ${T3_LINEAR_CONNECTION}`,
  parameters: Schema.Struct({
    query: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
    filters: Schema.optional(
      LinearIssueFilters.mapFields(Struct.map(Schema.optionalKey)).annotate({
        description: Object.entries(LinearFilterValuesDescription)
          .map(([field, description]) => `${field}: ${description}`)
          .join(" "),
      }),
    ),
    sort: Schema.optional(LinearIssueSort),
  }),
  success: LinearListIssuesResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Search Linear issues")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ListLinearFilterOptionsTool = Tool.make("list_linear_filter_options", {
  description: `List the connected Linear workspace's teams, statuses, open projects with their milestones, active users, and labels, with the ids search_linear_issues filters take. ${T3_LINEAR_CONNECTION}`,
  success: LinearFilterOptions,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "List Linear filter options")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const IssueLinksToolkit = Toolkit.make(
  LinkLinearIssueTool,
  UnlinkLinearIssueTool,
  LinkGitHubIssueTool,
  UnlinkGitHubIssueTool,
  ListThreadIssuesTool,
  ReadLinearIssueTool,
  SearchLinearIssuesTool,
  ListLinearFilterOptionsTool,
);
