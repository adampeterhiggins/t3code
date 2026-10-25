import {
  ComposerContextKind,
  DiscordError,
  DiscordThreadLink,
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
  GranolaError,
  GranolaThreadLink,
  McpCapabilityUnavailableError,
  NotionError,
  GoogleError,
  NotionSearchPagesResult,
  GoogleSearchFilesResult,
  GoogleListCalendarsResult,
  GoogleSearchPeopleResult,
  GOOGLE_CALENDAR_SEARCH_LIMIT,
  NotionThreadLink,
  GoogleThreadLink,
  IsoDateTime,
  OrchestratorMcpFailure,
  SlackError,
  SlackSearchMessagesResult,
  SlackThreadLink,
  ThreadId,
  ThreadLinkKind,
  ThreadLinkWatch,
  ThreadLinkWatchError,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpContextLinks from "../../McpContextLinks.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as DiscordThreadLinks from "../../../discord/DiscordThreadLinks.ts";
import * as GitHubIssueThreadLinks from "../../../githubIssues/GitHubIssueThreadLinks.ts";
import * as GranolaThreadLinks from "../../../granola/GranolaThreadLinks.ts";
import * as LinearApi from "../../../linear/LinearApi.ts";
import * as LinearThreadLinks from "../../../linear/LinearThreadLinks.ts";
import * as NotionThreadLinks from "../../../notion/NotionThreadLinks.ts";
import * as GoogleThreadLinks from "../../../google/GoogleThreadLinks.ts";
import * as NotionApi from "../../../notion/NotionApi.ts";
import * as GoogleApi from "../../../google/GoogleApi.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as SlackApi from "../../../slack/SlackApi.ts";
import * as SlackThreadLinks from "../../../slack/SlackThreadLinks.ts";
import { THREAD_LINK_WATCH_WAKE_LIMIT } from "../../../threadLinkWatch/linkWatchSnapshot.ts";
import * as ThreadLinkWatches from "../../../threadLinkWatch/ThreadLinkWatches.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  LinearThreadLinks.LinearThreadLinks,
  GitHubIssueThreadLinks.GitHubIssueThreadLinks,
  SlackThreadLinks.SlackThreadLinks,
  DiscordThreadLinks.DiscordThreadLinks,
  NotionThreadLinks.NotionThreadLinks,
  GoogleThreadLinks.GoogleThreadLinks,
  GranolaThreadLinks.GranolaThreadLinks,
  LinearApi.LinearApi,
  SlackApi.SlackApi,
  NotionApi.NotionApi,
  GoogleApi.GoogleApi,
  ServerSettings.ServerSettingsService,
  McpContextLinks.McpContextLinks,
  ThreadLinkWatches.ThreadLinkWatches,
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
  GranolaThreadLink,
  McpCapabilityUnavailableError,
  NotionThreadLink,
  GoogleThreadLink,
  IssueLinkThreadRequiredError,
  IssueLinkThreadNotFoundError,
  NoLinkedLinearIssueError,
  LinearError,
  GitHubIssueError,
  SlackError,
  NotionError,
  GoogleError,
  DiscordError,
  GranolaError,
  ThreadLinkWatchError,
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

export const ListThreadLinksResult = Schema.Struct({
  linear: Schema.NullOr(LinearThreadLink),
  github: Schema.NullOr(GitHubIssueThreadLink),
  slack: Schema.NullOr(SlackThreadLink),
  discord: Schema.NullOr(DiscordThreadLink),
  notion: Schema.NullOr(NotionThreadLink),
  google: Schema.NullOr(GoogleThreadLink),
  granola: Schema.NullOr(GranolaThreadLink),
  watches: Schema.Array(ThreadLinkWatch).annotate({
    description: "The links this thread watches with watch_thread_link.",
  }),
});
export type ListThreadLinksResult = typeof ListThreadLinksResult.Type;

export const LinkThreadLinkResult = Schema.Struct({
  kind: ThreadLinkKind,
  url: Schema.String,
  title: Schema.String,
  replacedUrl,
});
export type LinkThreadLinkResult = typeof LinkThreadLinkResult.Type;

export const UnwatchThreadLinkResult = Schema.Struct({
  wasWatching: Schema.Boolean.annotate({
    description: "False when the thread was not watching that link to begin with.",
  }),
});
export type UnwatchThreadLinkResult = typeof UnwatchThreadLinkResult.Type;

const linkKindParameter = ThreadLinkKind.annotate({
  description:
    "Which of the thread's links: linear, github, slack, discord, notion, google, or granola.",
});

export const ReadContextLinkResult = Schema.Struct({
  kind: ComposerContextKind,
  url: Schema.String,
  text: Schema.String.annotate({
    description: "What an agent receives when a user attaches this link to a message.",
  }),
});
export type ReadContextLinkResult = typeof ReadContextLinkResult.Type;

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

const ListThreadLinksTool = Tool.make("list_thread_links", {
  description: `Read what a thread is linked to (omit threadId for this thread): at most one Linear issue, GitHub issue, Slack thread, Discord thread, Notion page, Google file or event, and Granola note, null where none is linked. Returns each link's identity; pass its url to read_context_link for the contents. For pull requests use list_thread_pull_requests.`,
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Thread to read. Omit for this thread." }),
    ),
  }),
  success: ListThreadLinksResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "List thread links")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const LinkThreadLinkTool = Tool.make("link_thread_link", {
  description: `Link a Slack or Discord message's thread, Notion page, Google Drive file, folder or Calendar event, Granola note, Linear issue, or GitHub issue to a thread by its web link, so T3 Code shows it beside the thread and watch_thread_link can watch it. A thread (with its chat tabs) holds at most one link of each kind; linking another replaces it. Uses T3 Code's own connections, so the integration must be connected and turned on. For pull requests use link_pull_request.`,
  parameters: Schema.Struct({
    threadId: threadIdParameter,
    url: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)).annotate({
      description: "The object's web link, as a user would paste it.",
    }),
  }),
  success: LinkThreadLinkResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const UnlinkThreadLinkTool = Tool.make("unlink_thread_link", {
  description:
    "Remove a thread's link of one kind, which also stops watching it. Unlinking when none is linked succeeds with wasLinked=false.",
  parameters: Schema.Struct({ threadId: threadIdParameter, kind: linkKindParameter }),
  success: UnlinkIssueResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WatchThreadLinkTool = Tool.make("watch_thread_link", {
  description: `Wait on one of the thread's links without polling: T3 Code reads it on a schedule (Slack and Discord every minute, Linear and GitHub every two, Notion, Google and Granola every five) and wakes this thread with what changed: new or edited messages, an issue's status, assignee, or content, or an edited page or note. Changes that land while the thread is running arrive as one wake after it finishes. Watching starts from what the link shows now. It ends when the link is unlinked or replaced, the thread is archived, an issue closes, or after ${THREAD_LINK_WATCH_WAKE_LIMIT} wakes. Link the object first (link_thread_link). Watching the same link again keeps the current watch.`,
  parameters: Schema.Struct({ threadId: threadIdParameter, kind: linkKindParameter }),
  success: ThreadLinkWatch,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Watch thread link")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const UnwatchThreadLinkTool = Tool.make("unwatch_thread_link", {
  description:
    "Stop watching one of the thread's links. Call it when the work no longer needs the link watched. Unwatching when not watching succeeds with wasWatching=false.",
  parameters: Schema.Struct({ threadId: threadIdParameter, kind: linkKindParameter }),
  success: UnwatchThreadLinkResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unwatch thread link")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ReadContextLinkTool = Tool.make("read_context_link", {
  description: `Read a Slack or Discord message (with its thread), Notion page, Google Drive file, folder or Calendar event, Granola note, Linear issue, project, document, or initiative, GitHub issue, or GitHub release, tag, branch, or commit link through T3 Code's own connections, and return the same text a user attaching it to a message would send. Works without a separate MCP server for that service. Fails when the integration is disconnected or turned off, or cannot see the object. To give the link to another thread, use contextLinks on t3_thread_send instead.`,
  parameters: Schema.Struct({
    url: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)).annotate({
      description: "The object's web link, as a user would paste it.",
    }),
  }),
  success: ReadContextLinkResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read context link")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

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

const SearchSlackMessagesTool = Tool.make("search_slack_messages", {
  description: `Search Slack messages the connected Slack account can see, newest first, with Slack's own search syntax (in:#channel, from:@name, before:2026-01-01). Returns up to 20 message previews with their permalinks; pass a url to read_context_link for the whole thread. Uses T3 Code's own Slack connection (Settings > Integrations > Slack), so it works without a Slack MCP server. Fails when Slack is disconnected or turned off.`,
  parameters: Schema.Struct({
    query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  }),
  success: SlackSearchMessagesResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Search Slack messages")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const SearchNotionPagesTool = Tool.make("search_notion_pages", {
  description: `Search Notion pages by title among the pages shared with T3 Code's Notion connection (Settings > Integrations > Notion), not the whole workspace. Returns page titles and urls; pass a url to read_context_link for the page's contents. Works without a Notion MCP server. Fails when Notion is disconnected or turned off.`,
  parameters: Schema.Struct({
    query: Schema.String.check(Schema.isMaxLength(256)).annotate({
      description: "Title text to match. Empty lists recently edited pages.",
    }),
  }),
  success: NotionSearchPagesResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Search Notion pages")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);
const SearchGoogleFilesTool = Tool.make("search_google_files", {
  description: `Search Google Drive files or Calendar events through the connected Google account. Calendar searches default to the past 30 days and next year across the calendars ticked in Google Calendar; supply calendarIds (from list_google_calendars, or a colleague's email from search_google_people) and timeMin/timeMax to target other calendars or a date window. Returns page titles and urls; pass a url to read_context_link for the page's contents. Works without a Google MCP server. Fails when Google is disconnected or turned off.`,
  parameters: Schema.Struct({
    query: Schema.String.check(Schema.isMaxLength(256)).annotate({
      description:
        "Title text or a Google link. Empty lists recent Drive files or events in the date window.",
    }),
    source: Schema.optional(Schema.Literals(["drive", "calendar", "all"])),
    calendarId: Schema.optional(Schema.String.check(Schema.isMaxLength(512))).annotate({
      description: "One calendar to search. Prefer calendarIds.",
    }),
    calendarIds: Schema.optional(
      Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))).check(
        Schema.isMaxLength(GOOGLE_CALENDAR_SEARCH_LIMIT),
      ),
    ).annotate({
      description:
        "Calendars to search in place of the ticked ones. A colleague's calendar id is their email; calendars not shared with this account are skipped.",
    }),
    timeMin: Schema.optional(IsoDateTime),
    timeMax: Schema.optional(IsoDateTime),
  }),
  success: GoogleSearchFilesResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Search Google files")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ListGoogleCalendarsTool = Tool.make("list_google_calendars", {
  description: `List the calendars the connected Google account can read: its own, subscribed colleagues' and rooms', with names and whether each is ticked in Google Calendar (search_google_files searches the ticked ones by default). Pass ids to search_google_files as calendarIds. Fails when Google is disconnected or turned off.`,
  success: GoogleListCalendarsResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "List Google calendars")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);
const SearchGooglePeopleTool = Tool.make("search_google_people", {
  description: `Find colleagues by name or email in the connected Google account's Workspace directory. Each email is that person's calendar id for search_google_files calendarIds. directoryAvailable is false when the connection predates directory access; the user must reconnect Google in Settings > Integrations. Fails when Google is disconnected or turned off.`,
  parameters: Schema.Struct({
    query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
      description: "A name or email to look up.",
    }),
  }),
  success: GoogleSearchPeopleResult,
  failure: IssueLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Search Google people")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const IssueLinksToolkit = Toolkit.make(
  LinkLinearIssueTool,
  UnlinkLinearIssueTool,
  LinkGitHubIssueTool,
  UnlinkGitHubIssueTool,
  ListThreadLinksTool,
  LinkThreadLinkTool,
  UnlinkThreadLinkTool,
  WatchThreadLinkTool,
  UnwatchThreadLinkTool,
  ReadContextLinkTool,
  ReadLinearIssueTool,
  SearchLinearIssuesTool,
  ListLinearFilterOptionsTool,
  SearchSlackMessagesTool,
  SearchNotionPagesTool,
  SearchGoogleFilesTool,
  ListGoogleCalendarsTool,
  SearchGooglePeopleTool,
);
