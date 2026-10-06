import {
  PositiveInt,
  TrimmedNonEmptyString,
  UsageSummary,
  UsageSummaryInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

/**
 * The read-only history toolkit served at `/mcp/query`. Every tool is a
 * query: nothing here dispatches a command or touches a workspace. Lists are
 * small pages with opaque cursors, newest first unless `order` says otherwise,
 * and long text is cut with `truncated: true` plus the `get_*` call that
 * returns the rest.
 */

export class QueryToolError extends Schema.TaggedError<QueryToolError>()("QueryToolError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

const ISO_INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

const Instant = TrimmedNonEmptyString.check(
  Schema.isPattern(ISO_INSTANT_WITH_OFFSET, {
    message:
      "Use an ISO 8601 time with an offset, for example 2026-09-30T00:00:00+01:00 or 2026-09-30T08:00:00Z.",
  }),
);

const since = Schema.optional(
  Instant.annotate({
    description:
      "Inclusive lower bound: an ISO 8601 time with an offset, for example 2026-09-30T00:00:00+01:00. get_environment returns today's bounds.",
  }),
);
const until = Schema.optional(
  Instant.annotate({
    description:
      "Exclusive upper bound, same format as since. Nothing at or after it is returned, which makes it a hard cutoff for replaying a past day.",
  }),
);
const limit = (max: number, fallback: number) =>
  Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: max })).annotate({
      description: `Page size, 1 to ${max}. Defaults to ${fallback}.`,
    }),
  );
const cursor = Schema.optional(
  TrimmedNonEmptyString.annotate({
    description: "nextCursor from the previous page. Keep the other arguments the same.",
  }),
);
const order = Schema.optional(
  Schema.Literals(["asc", "desc"]).annotate({
    description: "desc (default) returns newest first; asc returns oldest first.",
  }),
);
const maxChars = (fallback: number, max: number) =>
  Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: max })).annotate({
      description: `Longest text to return before cutting it, ${fallback} by default, at most ${max}.`,
    }),
  );
const threadIdInput = TrimmedNonEmptyString.annotate({
  description: "Thread id from list_threads or get_activity_timeline.",
});
const optionalThreadId = Schema.optional(threadIdInput);
const optionalProjectId = Schema.optional(
  TrimmedNonEmptyString.annotate({ description: "Project id from list_projects." }),
);
const turnIdField = Schema.NullOr(Schema.String).annotate({
  description: "The turn (run) it belongs to, as list_turns returns it.",
});

const Page = {
  nextCursor: Schema.NullOr(Schema.String).annotate({
    description: "Pass as cursor to get the next page; null on the last page.",
  }),
};

const readOnly = <T extends Tool.Any>(tool: T, title: string): T =>
  tool
    .annotate(Tool.Title, title)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

const IMPORTED_NOTE =
  "Threads imported from before T3 Code's orchestration rewrite (importedFromV1) kept only their messages, so they have no turns, activities, plans or diffs.";

// ---------------------------------------------------------------------------
// Shared shapes

export const FileChange = Schema.Struct({
  path: Schema.String,
  kind: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
});
export type FileChange = typeof FileChange.Type;

export const PullRequestBrief = Schema.Struct({
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  isDraft: Schema.NullOr(Schema.Boolean),
});
export type PullRequestBrief = typeof PullRequestBrief.Type;

export const ThreadStartedBy = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("agent-access"), label: Schema.String }),
]);
export type ThreadStartedBy = typeof ThreadStartedBy.Type;

export const ThreadSummary = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.String,
  projectTitle: Schema.String,
  title: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String).annotate({ description: "Provider instance id." }),
  model: Schema.NullOr(Schema.String),
  runtimeMode: Schema.String,
  interactionMode: Schema.String.annotate({ description: "plan when the thread is in plan mode." }),
  createdAt: Schema.String,
  lastActivityAt: Schema.String.annotate({
    description: "Latest user message or turn activity; thread metadata changes do not count.",
  }),
  archivedAt: Schema.NullOr(Schema.String),
  settledAt: Schema.NullOr(Schema.String),
  settledOverride: Schema.NullOr(Schema.String).annotate({
    description: "'settled' or 'active' when the user moved the thread by hand.",
  }),
  pinnedAt: Schema.NullOr(Schema.String),
  snoozedUntil: Schema.NullOr(Schema.String),
  sessionStatus: Schema.NullOr(Schema.String).annotate({
    description:
      "Status of the thread's latest turn (running, waiting, completed, failed, interrupted, ...), or idle when it has none.",
  }),
  turnCount: Schema.Int.annotate({
    description: "Turns in the thread, not counting rolled back ones.",
  }),
  pendingApprovalCount: Schema.Int,
  pendingUserInputCount: Schema.Int,
  hasActionableProposedPlan: Schema.Boolean,
  tabGroupId: Schema.NullOr(Schema.String).annotate({
    description: "Threads that share a tab group are chat tabs over one workspace.",
  }),
  startedByThreadId: Schema.NullOr(Schema.String).annotate({
    description: "Set when an agent in that thread started this one.",
  }),
  startedBy: Schema.NullOr(ThreadStartedBy).annotate({
    description:
      "Who started the thread when an agent did: another thread's agent, or an agent outside T3 Code holding the named agent access token. Null when the user started it.",
  }),
  importedFromV1: Schema.Boolean.annotate({ description: IMPORTED_NOTE }),
  pullRequests: Schema.Array(PullRequestBrief).annotate({
    description: "The ten most recently linked; list_pull_requests with threadId has them all.",
  }),
  pullRequestCount: Schema.Int,
  window: Schema.optional(
    Schema.Struct({
      firstActivityAt: Schema.String,
      lastActivityAt: Schema.String,
      prompts: Schema.Int,
      turnsCompleted: Schema.Int,
      filesChanged: Schema.Int,
      additions: Schema.Int,
      deletions: Schema.Int,
    }).annotate({
      description: "Activity inside activeSince and activeUntil, when either is given.",
    }),
  ),
});
export type ThreadSummary = typeof ThreadSummary.Type;

export const TurnSummary = Schema.Struct({
  turnId: Schema.String.annotate({
    description: "The turn's run id. Other tools take it wherever they ask for a turnId.",
  }),
  threadId: Schema.String,
  turnCount: Schema.NullOr(Schema.Int).annotate({
    description:
      "Checkpoint number of the turn; get_turn_diff takes it. Null until the turn's checkpoint is captured.",
  }),
  state: Schema.String,
  requestedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String).annotate({
    description:
      "The message that started the turn. When background work woke the agent, this is the server's notice rather than something the user typed.",
  }),
  response: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean,
  fileCount: Schema.Int,
  additions: Schema.Int,
  deletions: Schema.Int,
  files: Schema.Array(FileChange),
  sourcePlanId: Schema.NullOr(Schema.String),
});
export type TurnSummary = typeof TurnSummary.Type;

export const MessageEntry = Schema.Struct({
  messageId: Schema.String,
  threadId: Schema.String,
  threadTitle: Schema.String,
  turnId: turnIdField,
  role: Schema.String,
  createdBy: Schema.NullOr(Schema.String).annotate({
    description:
      "user, agent or system. A user-role message from an agent or the system is a message another agent sent or a wake from background work.",
  }),
  createdAt: Schema.String,
  isStreaming: Schema.Boolean,
  text: Schema.String,
  truncated: Schema.Boolean,
  attachmentCount: Schema.Int,
});
export type MessageEntry = typeof MessageEntry.Type;

export const ActivityEntry = Schema.Struct({
  activityId: Schema.String,
  threadId: Schema.String,
  turnId: turnIdField,
  tone: Schema.String,
  kind: Schema.String,
  status: Schema.String,
  summary: Schema.String,
  detail: Schema.NullOr(Schema.String).annotate({
    description: "Short excerpt of the payload, such as the command a tool ran.",
  }),
  createdAt: Schema.String,
});
export type ActivityEntry = typeof ActivityEntry.Type;

export const PlanEntry = Schema.Struct({
  planId: Schema.String,
  threadId: Schema.String,
  threadTitle: Schema.String,
  turnId: turnIdField,
  title: Schema.String,
  preview: Schema.String,
  status: Schema.String.annotate({
    description: "active while it can still be implemented; completed once it was.",
  }),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  implementedAt: Schema.NullOr(Schema.String),
  implementationThreadId: Schema.NullOr(Schema.String),
});
export type PlanEntry = typeof PlanEntry.Type;

export const PullRequestEntry = Schema.Struct({
  ...PullRequestBrief.fields,
  headBranch: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  mergedAt: Schema.NullOr(Schema.String),
  closedAt: Schema.NullOr(Schema.String),
  additions: Schema.NullOr(Schema.Int),
  deletions: Schema.NullOr(Schema.Int),
  changedFiles: Schema.NullOr(Schema.Int),
  reviewDecision: Schema.NullOr(Schema.String),
  checksState: Schema.NullOr(Schema.String),
  syncedAt: Schema.NullOr(Schema.String).annotate({
    description: "When T3 Code last read the pull request from its host; state is as of then.",
  }),
  linkedAt: Schema.String,
  linkSource: Schema.String,
  threadId: Schema.String,
  threadTitle: Schema.String,
  projectId: Schema.String,
});
export type PullRequestEntry = typeof PullRequestEntry.Type;

export const TimelineKind = Schema.Literals([
  "thread.created",
  "prompt",
  "turn.completed",
  "plan.proposed",
  "plan.implemented",
  "pull_request.linked",
  "approval.requested",
  "error",
  "thread.archived",
  "thread.settled",
]);
export type TimelineKind = typeof TimelineKind.Type;

export const TimelineEntry = Schema.Struct({
  at: Schema.String,
  kind: TimelineKind,
  id: Schema.String.annotate({
    description:
      "Id for the follow-up call: messageId for prompt (get_message), turnId for turn.completed (get_turn), planId for plan.* (get_plan), url for pull_request.linked (get_pull_request), activityId for error (get_activity), requestId for approval.requested, threadId for thread.*.",
  }),
  threadId: Schema.String,
  threadTitle: Schema.String,
  projectId: Schema.String,
  projectTitle: Schema.String,
  turnId: turnIdField,
  summary: Schema.String,
});
export type TimelineEntry = typeof TimelineEntry.Type;

// ---------------------------------------------------------------------------
// Orientation

export const GetEnvironmentResult = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  platform: Schema.Unknown,
  serverVersion: Schema.String,
  now: Schema.String,
  timeZone: Schema.String,
  today: Schema.Struct({ since: Schema.String, until: Schema.String }).annotate({
    description: "Today's bounds in timeZone, ready to pass as since and until.",
  }),
  counts: Schema.Struct({
    projects: Schema.Int,
    threads: Schema.Int,
    archivedThreads: Schema.Int,
  }),
  guide: Schema.String,
});

const GetEnvironmentTool = Tool.make("get_environment", {
  description:
    "Start here. Describes this T3 Code environment: its name, the current time and time zone, today's since/until bounds, how much history it holds, and a short guide to the other tools.",
  // An empty struct serializes as `anyOf [object, array]`, which some
  // providers reject and then drop every tool on the server with it.
  parameters: Schema.Struct({
    timeZone: Schema.optional(
      TrimmedNonEmptyString.annotate({
        description:
          "IANA zone for today's bounds, for example Europe/London. Defaults to the server's zone.",
      }),
    ),
  }),
  success: GetEnvironmentResult,
  failure: QueryToolError,
});

export const GetActivityTimelineInput = Schema.Struct({
  since,
  until,
  projectId: optionalProjectId,
  threadId: optionalThreadId,
  kinds: Schema.optional(
    Schema.Array(TimelineKind).annotate({ description: "Only these kinds. Defaults to all." }),
  ),
  order,
  limit: limit(200, 100),
  cursor,
});
export type GetActivityTimelineInput = typeof GetActivityTimelineInput.Type;

const GetActivityTimelineTool = Tool.make("get_activity_timeline", {
  description:
    "A feed of what happened across every thread in a time range: prompts the user sent, turns that finished (with files changed), plans proposed or implemented, pull requests linked, approvals requested, errors, and threads created, archived or settled. Each entry names the id to drill into. For a day's overview, list_threads with activeSince is usually a better first call; use this for exact ordering or one kind of event.",
  parameters: GetActivityTimelineInput,
  success: Schema.Struct({ entries: Schema.Array(TimelineEntry), ...Page }),
  failure: QueryToolError,
});

// ---------------------------------------------------------------------------
// Projects and threads

export const ProjectSummary = Schema.Struct({
  projectId: Schema.String,
  title: Schema.String,
  workspaceRoot: Schema.String,
  createdAt: Schema.String,
  lastActivityAt: Schema.NullOr(Schema.String),
  threadCount: Schema.Int,
  archivedThreadCount: Schema.Int,
});
export type ProjectSummary = typeof ProjectSummary.Type;

export const ListProjectsInput = Schema.Struct({
  activeSince: since,
  activeUntil: until,
  limit: limit(100, 50),
  cursor,
});
export type ListProjectsInput = typeof ListProjectsInput.Type;

const ListProjectsTool = Tool.make("list_projects", {
  description:
    "List projects (workspace folders) with their thread counts, most recently active first. activeSince/activeUntil keep projects with a prompt or turn in that range.",
  parameters: ListProjectsInput,
  success: Schema.Struct({ projects: Schema.Array(ProjectSummary), ...Page }),
  failure: QueryToolError,
});

const GetProjectTool = Tool.make("get_project", {
  description:
    "One project in detail: its scripts, default model, thread counts, and its ten most recently active threads.",
  parameters: Schema.Struct({
    projectId: TrimmedNonEmptyString.annotate({ description: "Project id from list_projects." }),
  }),
  success: Schema.Struct({
    project: ProjectSummary,
    defaultModel: Schema.NullOr(Schema.String),
    scripts: Schema.Array(Schema.Struct({ name: Schema.String, command: Schema.String })),
    recentThreads: Schema.Array(ThreadSummary),
  }),
  failure: QueryToolError,
});

export const ListThreadsInput = Schema.Struct({
  projectId: optionalProjectId,
  activeSince: since,
  activeUntil: until,
  archived: Schema.optional(
    Schema.Literals(["exclude", "only", "include"]).annotate({
      description: "exclude (default) hides archived threads.",
    }),
  ),
  needsAttention: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "true keeps threads waiting on the user: a pending approval, a question, or a plan to act on.",
    }),
  ),
  hasPullRequest: Schema.optional(Schema.Boolean),
  provider: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Provider instance id or driver, for example codex or claudeAgent.",
    }),
  ),
  branch: Schema.optional(TrimmedNonEmptyString),
  titleContains: Schema.optional(TrimmedNonEmptyString),
  order,
  limit: limit(100, 25),
  cursor,
});
export type ListThreadsInput = typeof ListThreadsInput.Type;

const ListThreadsTool = Tool.make("list_threads", {
  description:
    "List threads (conversations with a coding agent), most recently active first. With activeSince and/or activeUntil it keeps threads the user worked in during that range and adds a window summary: prompts sent, turns completed, and lines changed in that range. That is the best overview of a day's work. Subagent threads are left out, as in the sidebar; get_subagent_transcript reads them. Follow up with get_thread, list_turns, or list_messages.",
  parameters: ListThreadsInput,
  success: Schema.Struct({ threads: Schema.Array(ThreadSummary), ...Page }),
  failure: QueryToolError,
});

const GetThreadTool = Tool.make("get_thread", {
  description:
    "One thread in detail: its summary, provider session state and last error, message and activity counts, open approvals (with the requestId, kind and prompt t3_approval_respond on /mcp/operate needs), plans, other tabs in its tab group, the first prompt, the latest reply, and every file its turns changed. list_pull_requests with threadId has its pull requests in full.",
  parameters: Schema.Struct({ threadId: threadIdInput }),
  success: Schema.Struct({
    thread: ThreadSummary,
    session: Schema.NullOr(
      Schema.Struct({
        status: Schema.String,
        provider: Schema.NullOr(Schema.String),
        activeTurnId: Schema.NullOr(Schema.String),
        lastError: Schema.NullOr(Schema.String),
        updatedAt: Schema.String,
      }),
    ),
    counts: Schema.Struct({
      messagesByRole: Schema.Record(Schema.String, Schema.Int),
      activitiesByTone: Schema.Record(Schema.String, Schema.Int),
    }),
    firstPrompt: Schema.NullOr(Schema.String),
    latestResponse: Schema.NullOr(Schema.String),
    pendingApprovals: Schema.Array(
      Schema.Struct({
        requestId: Schema.String,
        turnId: Schema.NullOr(Schema.String),
        kind: Schema.String.annotate({
          description: "command, file-read, file-change, mcp-elicitation or permission.",
        }),
        prompt: Schema.NullOr(Schema.String).annotate({
          description: "What the agent asked to do, as the app shows it.",
        }),
        options: Schema.NullOr(Schema.Unknown).annotate({
          description: "Approval choices the provider advertised, when it did.",
        }),
        createdAt: Schema.String,
      }),
    ),
    plans: Schema.Array(PlanEntry),
    tabs: Schema.Array(
      Schema.Struct({ threadId: Schema.String, title: Schema.String, position: Schema.Int }),
    ),
    changedFiles: Schema.Array(FileChange).annotate({
      description: "Every file the thread's turns changed, with lines summed across turns.",
    }),
    changedFilesTruncated: Schema.Boolean,
  }),
  failure: QueryToolError,
});

// ---------------------------------------------------------------------------
// Conversation content

export const ListTurnsInput = Schema.Struct({
  threadId: threadIdInput,
  since,
  until,
  order,
  limit: limit(100, 20),
  cursor,
  maxChars: maxChars(400, 4_000),
});
export type ListTurnsInput = typeof ListTurnsInput.Type;

const ListTurnsTool = Tool.make("list_turns", {
  description: `List a thread's turns (one prompt and the agent's work on it), with a preview of the prompt and final reply and the files each turn changed. turnId is the turn's run id. ${IMPORTED_NOTE}`,
  parameters: ListTurnsInput,
  success: Schema.Struct({ turns: Schema.Array(TurnSummary), ...Page }),
  failure: QueryToolError,
});

const GetTurnTool = Tool.make("get_turn", {
  description:
    "One turn in full: the prompt, the final reply, how many work items of each kind it had, the most recent notable activities, and the files it changed.",
  parameters: Schema.Struct({
    threadId: threadIdInput,
    turnId: TrimmedNonEmptyString.annotate({ description: "Turn id from list_turns." }),
    maxChars: maxChars(20_000, 100_000),
  }),
  success: Schema.Struct({
    turn: TurnSummary,
    activityCounts: Schema.Record(Schema.String, Schema.Int).annotate({
      description: "Activities in the turn by kind.",
    }),
    notableActivities: Schema.Array(ActivityEntry).annotate({
      description:
        "Tool calls, subagents, plan updates, questions, approvals and errors, newest last. list_activities with turnId has the rest.",
    }),
  }),
  failure: QueryToolError,
});

export const ListMessagesInput = Schema.Struct({
  threadId: optionalThreadId,
  projectId: optionalProjectId,
  role: Schema.optional(
    Schema.Literals(["user", "assistant", "any"]).annotate({
      description: "user is what was asked, assistant is what the agents replied. Defaults to any.",
    }),
  ),
  includeReasoning: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Also return reasoning summaries (role reasoning). Off by default; applies to role any and assistant.",
    }),
  ),
  since,
  until,
  order,
  limit: limit(100, 25),
  cursor,
  maxChars: maxChars(500, 20_000),
});
export type ListMessagesInput = typeof ListMessagesInput.Type;

const ListMessagesTool = Tool.make("list_messages", {
  description:
    "List messages in one thread, one project, or everywhere, filtered by role and time. Use role=user with since/until to see everything the user asked for in a period; createdBy tells the user's own prompts from agent messages and wakes.",
  parameters: ListMessagesInput,
  success: Schema.Struct({ messages: Schema.Array(MessageEntry), ...Page }),
  failure: QueryToolError,
});

const GetMessageTool = Tool.make("get_message", {
  description:
    "One message in full, with its attachments' names and types and any context the composer attached (for example a referenced issue or thread).",
  parameters: Schema.Struct({
    messageId: TrimmedNonEmptyString,
    maxChars: maxChars(50_000, 200_000),
  }),
  success: Schema.Struct({
    message: MessageEntry,
    attachments: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        name: Schema.NullOr(Schema.String),
        mimeType: Schema.NullOr(Schema.String),
        sizeBytes: Schema.NullOr(Schema.Int),
      }),
    ),
    context: Schema.Unknown,
  }),
  failure: QueryToolError,
});

export const SearchInput = Schema.Struct({
  query: TrimmedNonEmptyString.check(Schema.isMinLength(2), Schema.isMaxLength(200)).annotate({
    description: "Text to find, case-insensitive. Matches thread titles and message text.",
  }),
  projectId: optionalProjectId,
  threadId: optionalThreadId,
  role: Schema.optional(Schema.Literals(["user", "assistant", "any"])),
  since,
  until,
  limit: limit(50, 20),
});
export type SearchInput = typeof SearchInput.Type;

const SearchTool = Tool.make("search", {
  description:
    "Find threads and messages containing some text, newest first, with a snippet around each match. Reasoning is not searched.",
  parameters: SearchInput,
  success: Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        threadId: Schema.String,
        title: Schema.String,
        projectTitle: Schema.String,
        lastActivityAt: Schema.String,
      }),
    ),
    messages: Schema.Array(
      Schema.Struct({
        messageId: Schema.String,
        threadId: Schema.String,
        threadTitle: Schema.String,
        role: Schema.String,
        createdAt: Schema.String,
        snippet: Schema.String,
      }),
    ),
  }),
  failure: QueryToolError,
});

export const ListActivitiesInput = Schema.Struct({
  threadId: optionalThreadId,
  turnId: Schema.optional(TrimmedNonEmptyString),
  projectId: optionalProjectId,
  tone: Schema.optional(
    Schema.Literals(["info", "tool", "approval", "error"]).annotate({
      description:
        "tool: command_execution, file_change, dynamic_tool, file_search, web_search and subagent. approval: approval_request and user_input_request. error: error. info: everything else.",
    }),
  ),
  kinds: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).annotate({
      description:
        "Exact kinds, for example command_execution, file_change, dynamic_tool, subagent, error, approval_request, user_input_request, todo_list, proposed_plan, notification, checkpoint, web_search, compaction.",
    }),
  ),
  since,
  until,
  order,
  limit: limit(100, 50),
  cursor,
});
export type ListActivitiesInput = typeof ListActivitiesInput.Type;

const ListActivitiesTool = Tool.make("list_activities", {
  description: `List the work log behind turns: tool calls, file changes, subagents, plan updates, questions, approvals, notifications and errors. Filter by thread, turn, project, tone, kind and time. Messages and reasoning are not activities; list_messages has them. ${IMPORTED_NOTE}`,
  parameters: ListActivitiesInput,
  success: Schema.Struct({ activities: Schema.Array(ActivityEntry), ...Page }),
  failure: QueryToolError,
});

const GetActivityTool = Tool.make("get_activity", {
  description: "One activity with its full payload, such as a tool call's input and output.",
  parameters: Schema.Struct({
    activityId: TrimmedNonEmptyString,
    maxChars: maxChars(20_000, 100_000),
  }),
  success: Schema.Struct({
    activity: ActivityEntry,
    payload: Schema.Unknown.annotate({
      description: "Parsed payload, or its text cut to maxChars when truncated is true.",
    }),
    truncated: Schema.Boolean,
  }),
  failure: QueryToolError,
});

export const SubagentTranscriptEntry = Schema.Struct({
  kind: Schema.Literals(["user", "assistant", "reasoning", "tool"]),
  /** Message text, or the tool's title for tool entries. */
  text: Schema.String,
  toolName: Schema.optional(Schema.String),
  input: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  at: Schema.optional(Schema.String),
});
export type SubagentTranscriptEntry = typeof SubagentTranscriptEntry.Type;

export const SubagentTranscript = Schema.Struct({
  taskId: Schema.String,
  childThreadId: Schema.NullOr(Schema.String).annotate({
    description: "The subagent's own thread; get_thread and list_messages read it too.",
  }),
  title: Schema.NullOr(Schema.String),
  status: Schema.String,
  prompt: Schema.String,
  result: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  entries: Schema.Array(SubagentTranscriptEntry),
  truncated: Schema.Boolean.annotate({
    description: "True when older entries were dropped or long text was cut.",
  }),
});
export type SubagentTranscript = typeof SubagentTranscript.Type;

const GetSubagentTranscriptTool = Tool.make("get_subagent_transcript", {
  description:
    "A subagent's own conversation, read from the thread T3 Code kept for it. taskId is the activityId of a subagent activity (list_activities with kinds [subagent]), or the subagent's child thread id. A subagent without a thread of its own returns just its prompt and result.",
  parameters: Schema.Struct({ threadId: threadIdInput, taskId: TrimmedNonEmptyString }),
  success: SubagentTranscript,
  failure: QueryToolError,
});

// ---------------------------------------------------------------------------
// Plans, code and pull requests

export const ListPlansInput = Schema.Struct({
  threadId: optionalThreadId,
  projectId: optionalProjectId,
  implemented: Schema.optional(
    Schema.Boolean.annotate({
      description: "true for plans that were implemented, false for plans that were not.",
    }),
  ),
  since,
  until,
  order,
  limit: limit(100, 20),
  cursor,
});
export type ListPlansInput = typeof ListPlansInput.Type;

const ListPlansTool = Tool.make("list_plans", {
  description:
    "List plans agents proposed, with a title, a preview, and whether they were built (implementedAt, set when a turn started from the plan).",
  parameters: ListPlansInput,
  success: Schema.Struct({ plans: Schema.Array(PlanEntry), ...Page }),
  failure: QueryToolError,
});

const GetPlanTool = Tool.make("get_plan", {
  description: "One proposed plan's full markdown.",
  parameters: Schema.Struct({ planId: TrimmedNonEmptyString, maxChars: maxChars(50_000, 200_000) }),
  success: Schema.Struct({ plan: PlanEntry, markdown: Schema.String, truncated: Schema.Boolean }),
  failure: QueryToolError,
});

export const GetTurnDiffInput = Schema.Struct({
  threadId: threadIdInput,
  turnId: Schema.optional(
    TrimmedNonEmptyString.annotate({ description: "One turn's changes. Or pass a range." }),
  ),
  fromTurnCount: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
      description: "Exclusive start of a range of turnCount values; 0 is before the first turn.",
    }),
  ),
  toTurnCount: Schema.optional(
    PositiveInt.annotate({ description: "Inclusive end of the range." }),
  ),
  includePatch: Schema.optional(
    Schema.Boolean.annotate({
      description: "Also return the unified diff. Off by default; the file list is usually enough.",
    }),
  ),
  maxChars: maxChars(20_000, 200_000),
});
export type GetTurnDiffInput = typeof GetTurnDiffInput.Type;

const GetTurnDiffTool = Tool.make("get_turn_diff", {
  description:
    "What a turn, or a range of turns, changed in the workspace: the files with lines added and removed, and optionally the patch read from T3 Code's checkpoints. Ranges use the turnCount values list_turns returns; only completed turns with a checkpoint count.",
  parameters: GetTurnDiffInput,
  success: Schema.Struct({
    threadId: Schema.String,
    fromTurnCount: Schema.Int,
    toTurnCount: Schema.Int,
    files: Schema.Array(FileChange),
    patch: Schema.NullOr(Schema.String),
    truncated: Schema.Boolean,
  }),
  failure: QueryToolError,
});

export const ListPullRequestsInput = Schema.Struct({
  projectId: optionalProjectId,
  threadId: optionalThreadId,
  state: Schema.optional(Schema.Literals(["open", "closed", "merged"])),
  since: Schema.optional(
    Instant.annotate({ description: "Inclusive lower bound on when the link was made." }),
  ),
  until: Schema.optional(
    Instant.annotate({ description: "Exclusive upper bound on when the link was made." }),
  ),
  order,
  limit: limit(100, 25),
  cursor,
});
export type ListPullRequestsInput = typeof ListPullRequestsInput.Type;

const ListPullRequestsTool = Tool.make("list_pull_requests", {
  description:
    "List pull requests linked to threads, newest link first, with their last synced state, branches, size and checks. A pull request linked to two threads appears once per thread.",
  parameters: ListPullRequestsInput,
  success: Schema.Struct({ pullRequests: Schema.Array(PullRequestEntry), ...Page }),
  failure: QueryToolError,
});

const GetPullRequestTool = Tool.make("get_pull_request", {
  description:
    "One pull request by URL, or by repository and number: its last synced state and every thread linked to it.",
  parameters: Schema.Struct({
    url: Schema.optional(TrimmedNonEmptyString),
    repository: Schema.optional(
      TrimmedNonEmptyString.annotate({ description: "owner/repo, used with number." }),
    ),
    number: Schema.optional(PositiveInt),
  }),
  success: Schema.Struct({ links: Schema.Array(PullRequestEntry) }),
  failure: QueryToolError,
});

const GetUsageSummaryTool = Tool.make("get_usage_summary", {
  description:
    "Token usage and estimated cost per provider and model, as on the Usage page. Days are inclusive and bucketed in timeZone.",
  parameters: UsageSummaryInput,
  success: UsageSummary,
  failure: QueryToolError,
});

export const QueryToolkit = Toolkit.make(
  readOnly(GetEnvironmentTool, "Describe environment"),
  readOnly(GetActivityTimelineTool, "Activity timeline"),
  readOnly(ListProjectsTool, "List projects"),
  readOnly(GetProjectTool, "Get project"),
  readOnly(ListThreadsTool, "List threads"),
  readOnly(GetThreadTool, "Get thread"),
  readOnly(ListTurnsTool, "List turns"),
  readOnly(GetTurnTool, "Get turn"),
  readOnly(ListMessagesTool, "List messages"),
  readOnly(GetMessageTool, "Get message"),
  readOnly(SearchTool, "Search threads and messages"),
  readOnly(ListActivitiesTool, "List activities"),
  readOnly(GetActivityTool, "Get activity"),
  readOnly(GetSubagentTranscriptTool, "Get subagent transcript"),
  readOnly(ListPlansTool, "List plans"),
  readOnly(GetPlanTool, "Get plan"),
  readOnly(GetTurnDiffTool, "Get turn diff"),
  readOnly(ListPullRequestsTool, "List pull requests"),
  readOnly(GetPullRequestTool, "Get pull request"),
  readOnly(GetUsageSummaryTool, "Get usage summary"),
);
