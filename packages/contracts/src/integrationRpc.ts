import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  LinearCancelLoginInput,
  LinearCompleteLoginInput,
  LinearConnectionState,
  LinearError,
  LinearFilterOptions,
  LinearGetIssueInput,
  LinearGetObjectInput,
  LinearIssueContext,
  LinearObjectContext,
  LinearIssueSummary,
  LinearLinkThreadInput,
  LinearListIssuesInput,
  LinearListIssuesResult,
  LinearThreadLink,
  LinearThreadLinks,
  LinearUnlinkThreadInput,
} from "./linear.ts";
import {
  NotionError,
  NotionConnectionState,
  NotionCompleteLoginInput,
  NotionStartLoginInput,
  NotionCancelLoginInput,
  NotionSearchPagesInput,
  NotionSearchPagesResult,
  NotionGetPageInput,
  NotionPageContext,
  NotionLinkThreadInput,
  NotionThreadLink,
  NotionThreadLinks,
  NotionUnlinkThreadInput,
} from "./notion.ts";
import {
  GoogleError,
  GoogleConnectionState,
  GoogleCompleteLoginInput,
  GoogleStartLoginInput,
  GoogleCancelLoginInput,
  GoogleSearchFilesInput,
  GoogleSearchFilesResult,
  GoogleListCalendarsResult,
  GoogleSearchPeopleInput,
  GoogleSearchPeopleResult,
  GoogleGetFileInput,
  GoogleFileContext,
  GoogleLinkThreadInput,
  GoogleThreadLink,
  GoogleThreadLinks,
  GoogleUnlinkThreadInput,
} from "./google.ts";
import {
  GranolaCancelLoginInput,
  GranolaConnectionState,
  GranolaError,
  GranolaGetNoteInput,
  GranolaLinkThreadInput,
  GranolaNoteContext,
  GranolaNoteSummary,
  GranolaThreadLink,
  GranolaThreadLinks,
  GranolaUnlinkThreadInput,
  GranolaSearchNotesInput,
  GranolaSearchNotesResult,
} from "./granola.ts";
import {
  SlackCancelLoginInput,
  SlackCompleteLoginInput,
  SlackConnectionState,
  SlackError,
  SlackGetThreadInput,
  SlackLinkPreview,
  SlackLinkPreviewInput,
  SlackSearchMessagesInput,
  SlackSearchMessagesResult,
  SlackStartLoginInput,
  SlackSuggestionsInput,
  SlackSuggestionsResult,
  SlackThreadContext,
  SlackLinkThreadInput,
  SlackThreadLink,
  SlackThreadLinks,
  SlackUnlinkThreadInput,
} from "./slack.ts";
import {
  DiscordConnectInput,
  DiscordConnectionState,
  DiscordError,
  DiscordGetThreadInput,
  DiscordLeaveServerInput,
  DiscordListServersResult,
  DiscordLinkPreview,
  DiscordLinkPreviewInput,
  DiscordLinkThreadInput,
  DiscordSearchMessagesInput,
  DiscordSearchMessagesResult,
  DiscordThreadContext,
  DiscordThreadLink,
  DiscordThreadLinks,
  DiscordUnlinkThreadInput,
} from "./discord.ts";
import {
  GitHubGetIssueInput,
  GitHubIssueContext,
  GitHubIssueError,
  GitHubIssueSummary,
  GitHubIssueThreadLink,
  GitHubIssueThreadLinks,
  GitHubLinkThreadInput,
  GitHubListIssuesInput,
  GitHubListIssuesResult,
  GitHubUnlinkThreadInput,
} from "./githubIssues.ts";
import { GitHubGetRefInput, GitHubRefContext } from "./githubRefs.ts";
import {
  ThreadLinkWatch,
  ThreadLinkWatchError,
  ThreadLinkWatches,
  ThreadLinkWatchSetInput,
} from "./threadLinkWatch.ts";

export const INTEGRATION_WS_METHODS = {
  linearSubscribeState: "linear.subscribeState",
  linearStartLogin: "linear.startLogin",
  linearCompleteLogin: "linear.completeLogin",
  linearCancelLogin: "linear.cancelLogin",
  linearDisconnect: "linear.disconnect",
  linearListIssues: "linear.listIssues",
  linearGetIssue: "linear.getIssue",
  linearGetFilterOptions: "linear.getFilterOptions",
  linearGetIssueSummary: "linear.getIssueSummary",
  linearGetObject: "linear.getObject",
  linearSubscribeThreadLinks: "linear.subscribeThreadLinks",
  linearLinkThread: "linear.linkThread",
  linearUnlinkThread: "linear.unlinkThread",

  notionSubscribeState: "notion.subscribeState",
  notionStartLogin: "notion.startLogin",
  notionCompleteLogin: "notion.completeLogin",
  notionCancelLogin: "notion.cancelLogin",
  notionDisconnect: "notion.disconnect",
  notionSearchPages: "notion.searchPages",
  notionGetPage: "notion.getPage",
  notionSubscribeThreadLinks: "notion.subscribeThreadLinks",
  notionLinkThread: "notion.linkThread",
  notionUnlinkThread: "notion.unlinkThread",
  googleSubscribeState: "google.subscribeState",
  googleStartLogin: "google.startLogin",
  googleCompleteLogin: "google.completeLogin",
  googleCancelLogin: "google.cancelLogin",
  googleDisconnect: "google.disconnect",
  googleSearchFiles: "google.searchFiles",
  googleListCalendars: "google.listCalendars",
  googleSearchPeople: "google.searchPeople",
  googleGetFile: "google.getFile",
  googleSubscribeThreadLinks: "google.subscribeThreadLinks",
  googleLinkThread: "google.linkThread",
  googleUnlinkThread: "google.unlinkThread",
  granolaSubscribeState: "granola.subscribeState",
  granolaStartLogin: "granola.startLogin",
  granolaCancelLogin: "granola.cancelLogin",
  granolaDisconnect: "granola.disconnect",
  granolaSearchNotes: "granola.searchNotes",
  granolaGetNote: "granola.getNote",
  granolaGetNoteSummary: "granola.getNoteSummary",
  granolaSubscribeThreadLinks: "granola.subscribeThreadLinks",
  granolaLinkThread: "granola.linkThread",
  granolaUnlinkThread: "granola.unlinkThread",
  slackSubscribeState: "slack.subscribeState",
  slackStartLogin: "slack.startLogin",
  slackCompleteLogin: "slack.completeLogin",
  slackCancelLogin: "slack.cancelLogin",
  slackDisconnect: "slack.disconnect",
  slackSearchMessages: "slack.searchMessages",
  slackSuggestions: "slack.suggestions",
  slackGetThread: "slack.getThread",
  slackGetLinkPreview: "slack.getLinkPreview",
  slackSubscribeThreadLinks: "slack.subscribeThreadLinks",
  slackLinkThread: "slack.linkThread",
  slackUnlinkThread: "slack.unlinkThread",
  discordSubscribeState: "discord.subscribeState",
  discordConnect: "discord.connect",
  discordDisconnect: "discord.disconnect",
  discordListServers: "discord.listServers",
  discordLeaveServer: "discord.leaveServer",
  discordSearchMessages: "discord.searchMessages",
  discordGetThread: "discord.getThread",
  discordGetLinkPreview: "discord.getLinkPreview",
  discordSubscribeThreadLinks: "discord.subscribeThreadLinks",
  discordLinkThread: "discord.linkThread",
  discordUnlinkThread: "discord.unlinkThread",
  threadLinkWatchesSubscribe: "threadLinkWatches.subscribe",
  threadLinkWatchSet: "threadLinkWatches.set",

  githubIssuesList: "githubIssues.list",
  githubIssuesGet: "githubIssues.get",
  githubIssuesGetSummary: "githubIssues.getSummary",
  githubIssuesSubscribeThreadLinks: "githubIssues.subscribeThreadLinks",
  githubIssuesLinkThread: "githubIssues.linkThread",
  githubIssuesUnlinkThread: "githubIssues.unlinkThread",
  githubRefsGet: "githubRefs.get",
} as const;

const LinearRpcError = Schema.Union([LinearError, EnvironmentAuthorizationError]);

const WsLinearSubscribeStateRpc = Rpc.make(INTEGRATION_WS_METHODS.linearSubscribeState, {
  payload: Schema.Struct({}),
  success: LinearConnectionState,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsLinearStartLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.linearStartLogin, {
  payload: Schema.Struct({}),
  success: LinearConnectionState,
  error: LinearRpcError,
});

const WsLinearCompleteLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.linearCompleteLogin, {
  payload: LinearCompleteLoginInput,
  success: LinearConnectionState,
  error: LinearRpcError,
});

const WsLinearCancelLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.linearCancelLogin, {
  payload: LinearCancelLoginInput,
  success: LinearConnectionState,
  error: LinearRpcError,
});

const WsLinearDisconnectRpc = Rpc.make(INTEGRATION_WS_METHODS.linearDisconnect, {
  payload: Schema.Struct({}),
  success: LinearConnectionState,
  error: LinearRpcError,
});

const WsLinearListIssuesRpc = Rpc.make(INTEGRATION_WS_METHODS.linearListIssues, {
  payload: LinearListIssuesInput,
  success: LinearListIssuesResult,
  error: LinearRpcError,
});

const WsLinearGetIssueRpc = Rpc.make(INTEGRATION_WS_METHODS.linearGetIssue, {
  payload: LinearGetIssueInput,
  success: LinearIssueContext,
  error: LinearRpcError,
});

const WsLinearGetFilterOptionsRpc = Rpc.make(INTEGRATION_WS_METHODS.linearGetFilterOptions, {
  payload: Schema.Struct({}),
  success: LinearFilterOptions,
  error: LinearRpcError,
});

const WsLinearGetIssueSummaryRpc = Rpc.make(INTEGRATION_WS_METHODS.linearGetIssueSummary, {
  payload: LinearGetIssueInput,
  success: LinearIssueSummary,
  error: LinearRpcError,
});

const WsLinearGetObjectRpc = Rpc.make(INTEGRATION_WS_METHODS.linearGetObject, {
  payload: LinearGetObjectInput,
  success: LinearObjectContext,
  error: LinearRpcError,
});

const WsLinearSubscribeThreadLinksRpc = Rpc.make(
  INTEGRATION_WS_METHODS.linearSubscribeThreadLinks,
  {
    payload: Schema.Struct({}),
    success: LinearThreadLinks,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

const WsLinearLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.linearLinkThread, {
  payload: LinearLinkThreadInput,
  success: LinearThreadLink,
  error: LinearRpcError,
});

const WsLinearUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.linearUnlinkThread, {
  payload: LinearUnlinkThreadInput,
  success: Schema.Struct({}),
  error: LinearRpcError,
});

const NotionRpcError = Schema.Union([NotionError, EnvironmentAuthorizationError]);
const WsNotionSubscribeStateRpc = Rpc.make(INTEGRATION_WS_METHODS.notionSubscribeState, {
  payload: Schema.Struct({}),
  success: NotionConnectionState,
  error: NotionRpcError,
  stream: true,
});
const WsNotionStartLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.notionStartLogin, {
  payload: NotionStartLoginInput,
  success: NotionConnectionState,
  error: NotionRpcError,
});
const WsNotionCompleteLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.notionCompleteLogin, {
  payload: NotionCompleteLoginInput,
  success: NotionConnectionState,
  error: NotionRpcError,
});
const WsNotionCancelLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.notionCancelLogin, {
  payload: NotionCancelLoginInput,
  success: NotionConnectionState,
  error: NotionRpcError,
});
const WsNotionDisconnectRpc = Rpc.make(INTEGRATION_WS_METHODS.notionDisconnect, {
  payload: Schema.Struct({}),
  success: NotionConnectionState,
  error: NotionRpcError,
});
const WsNotionSearchPagesRpc = Rpc.make(INTEGRATION_WS_METHODS.notionSearchPages, {
  payload: NotionSearchPagesInput,
  success: NotionSearchPagesResult,
  error: NotionRpcError,
});
const WsNotionGetPageRpc = Rpc.make(INTEGRATION_WS_METHODS.notionGetPage, {
  payload: NotionGetPageInput,
  success: NotionPageContext,
  error: NotionRpcError,
});
const WsNotionSubscribeThreadLinksRpc = Rpc.make(
  INTEGRATION_WS_METHODS.notionSubscribeThreadLinks,
  {
    payload: Schema.Struct({}),
    success: NotionThreadLinks,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);
const WsNotionLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.notionLinkThread, {
  payload: NotionLinkThreadInput,
  success: NotionThreadLink,
  error: NotionRpcError,
});
const WsNotionUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.notionUnlinkThread, {
  payload: NotionUnlinkThreadInput,
  success: Schema.Struct({}),
  error: NotionRpcError,
});

const GoogleRpcError = Schema.Union([GoogleError, EnvironmentAuthorizationError]);
const WsGoogleSubscribeStateRpc = Rpc.make(INTEGRATION_WS_METHODS.googleSubscribeState, {
  payload: Schema.Struct({}),
  success: GoogleConnectionState,
  error: GoogleRpcError,
  stream: true,
});
const WsGoogleStartLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.googleStartLogin, {
  payload: GoogleStartLoginInput,
  success: GoogleConnectionState,
  error: GoogleRpcError,
});
const WsGoogleCompleteLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.googleCompleteLogin, {
  payload: GoogleCompleteLoginInput,
  success: GoogleConnectionState,
  error: GoogleRpcError,
});
const WsGoogleCancelLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.googleCancelLogin, {
  payload: GoogleCancelLoginInput,
  success: GoogleConnectionState,
  error: GoogleRpcError,
});
const WsGoogleDisconnectRpc = Rpc.make(INTEGRATION_WS_METHODS.googleDisconnect, {
  payload: Schema.Struct({}),
  success: GoogleConnectionState,
  error: GoogleRpcError,
});
const WsGoogleSearchFilesRpc = Rpc.make(INTEGRATION_WS_METHODS.googleSearchFiles, {
  payload: GoogleSearchFilesInput,
  success: GoogleSearchFilesResult,
  error: GoogleRpcError,
});
const WsGoogleListCalendarsRpc = Rpc.make(INTEGRATION_WS_METHODS.googleListCalendars, {
  payload: Schema.Struct({}),
  success: GoogleListCalendarsResult,
  error: GoogleRpcError,
});
const WsGoogleSearchPeopleRpc = Rpc.make(INTEGRATION_WS_METHODS.googleSearchPeople, {
  payload: GoogleSearchPeopleInput,
  success: GoogleSearchPeopleResult,
  error: GoogleRpcError,
});
const WsGoogleGetFileRpc = Rpc.make(INTEGRATION_WS_METHODS.googleGetFile, {
  payload: GoogleGetFileInput,
  success: GoogleFileContext,
  error: GoogleRpcError,
});
const WsGoogleSubscribeThreadLinksRpc = Rpc.make(
  INTEGRATION_WS_METHODS.googleSubscribeThreadLinks,
  {
    payload: Schema.Struct({}),
    success: GoogleThreadLinks,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);
const WsGoogleLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.googleLinkThread, {
  payload: GoogleLinkThreadInput,
  success: GoogleThreadLink,
  error: GoogleRpcError,
});
const WsGoogleUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.googleUnlinkThread, {
  payload: GoogleUnlinkThreadInput,
  success: Schema.Struct({}),
  error: GoogleRpcError,
});

const GranolaRpcError = Schema.Union([GranolaError, EnvironmentAuthorizationError]);
const WsGranolaSubscribeStateRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaSubscribeState, {
  payload: Schema.Struct({}),
  success: GranolaConnectionState,
  error: GranolaRpcError,
  stream: true,
});
const WsGranolaStartLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaStartLogin, {
  payload: Schema.Struct({}),
  success: GranolaConnectionState,
  error: GranolaRpcError,
});
const WsGranolaCancelLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaCancelLogin, {
  payload: GranolaCancelLoginInput,
  success: GranolaConnectionState,
  error: GranolaRpcError,
});
const WsGranolaDisconnectRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaDisconnect, {
  payload: Schema.Struct({}),
  success: GranolaConnectionState,
  error: GranolaRpcError,
});
const WsGranolaSearchNotesRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaSearchNotes, {
  payload: GranolaSearchNotesInput,
  success: GranolaSearchNotesResult,
  error: GranolaRpcError,
});
const WsGranolaGetNoteRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaGetNote, {
  payload: GranolaGetNoteInput,
  success: GranolaNoteContext,
  error: GranolaRpcError,
});
/** A note's title and meeting, for naming a bare note link; the server keeps each one it reads. */
const WsGranolaGetNoteSummaryRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaGetNoteSummary, {
  payload: GranolaGetNoteInput,
  success: GranolaNoteSummary,
  error: GranolaRpcError,
});
const WsGranolaSubscribeThreadLinksRpc = Rpc.make(
  INTEGRATION_WS_METHODS.granolaSubscribeThreadLinks,
  {
    payload: Schema.Struct({}),
    success: GranolaThreadLinks,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);
const WsGranolaLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaLinkThread, {
  payload: GranolaLinkThreadInput,
  success: GranolaThreadLink,
  error: GranolaRpcError,
});
const WsGranolaUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.granolaUnlinkThread, {
  payload: GranolaUnlinkThreadInput,
  success: Schema.Struct({}),
  error: GranolaRpcError,
});

const SlackRpcError = Schema.Union([SlackError, EnvironmentAuthorizationError]);

const WsSlackSubscribeStateRpc = Rpc.make(INTEGRATION_WS_METHODS.slackSubscribeState, {
  payload: Schema.Struct({}),
  success: SlackConnectionState,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSlackStartLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.slackStartLogin, {
  payload: SlackStartLoginInput,
  success: SlackConnectionState,
  error: SlackRpcError,
});

const WsSlackCompleteLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.slackCompleteLogin, {
  payload: SlackCompleteLoginInput,
  success: SlackConnectionState,
  error: SlackRpcError,
});

const WsSlackCancelLoginRpc = Rpc.make(INTEGRATION_WS_METHODS.slackCancelLogin, {
  payload: SlackCancelLoginInput,
  success: SlackConnectionState,
  error: SlackRpcError,
});

const WsSlackDisconnectRpc = Rpc.make(INTEGRATION_WS_METHODS.slackDisconnect, {
  payload: Schema.Struct({}),
  success: SlackConnectionState,
  error: SlackRpcError,
});

const WsSlackSearchMessagesRpc = Rpc.make(INTEGRATION_WS_METHODS.slackSearchMessages, {
  payload: SlackSearchMessagesInput,
  success: SlackSearchMessagesResult,
  error: SlackRpcError,
});

const WsSlackSuggestionsRpc = Rpc.make(INTEGRATION_WS_METHODS.slackSuggestions, {
  payload: SlackSuggestionsInput,
  success: SlackSuggestionsResult,
  error: SlackRpcError,
});

const WsSlackGetThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.slackGetThread, {
  payload: SlackGetThreadInput,
  success: SlackThreadContext,
  error: SlackRpcError,
});

const WsSlackGetLinkPreviewRpc = Rpc.make(INTEGRATION_WS_METHODS.slackGetLinkPreview, {
  payload: SlackLinkPreviewInput,
  success: SlackLinkPreview,
  error: SlackRpcError,
});

const WsSlackSubscribeThreadLinksRpc = Rpc.make(INTEGRATION_WS_METHODS.slackSubscribeThreadLinks, {
  payload: Schema.Struct({}),
  success: SlackThreadLinks,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSlackLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.slackLinkThread, {
  payload: SlackLinkThreadInput,
  success: SlackThreadLink,
  error: SlackRpcError,
});

const WsSlackUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.slackUnlinkThread, {
  payload: SlackUnlinkThreadInput,
  success: Schema.Struct({}),
  error: SlackRpcError,
});

const DiscordRpcError = Schema.Union([DiscordError, EnvironmentAuthorizationError]);

const WsDiscordSubscribeStateRpc = Rpc.make(INTEGRATION_WS_METHODS.discordSubscribeState, {
  payload: Schema.Struct({}),
  success: DiscordConnectionState,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsDiscordConnectRpc = Rpc.make(INTEGRATION_WS_METHODS.discordConnect, {
  payload: DiscordConnectInput,
  success: DiscordConnectionState,
  error: DiscordRpcError,
});

const WsDiscordDisconnectRpc = Rpc.make(INTEGRATION_WS_METHODS.discordDisconnect, {
  payload: Schema.Struct({}),
  success: DiscordConnectionState,
  error: DiscordRpcError,
});

const WsDiscordListServersRpc = Rpc.make(INTEGRATION_WS_METHODS.discordListServers, {
  payload: Schema.Struct({}),
  success: DiscordListServersResult,
  error: DiscordRpcError,
});

const WsDiscordLeaveServerRpc = Rpc.make(INTEGRATION_WS_METHODS.discordLeaveServer, {
  payload: DiscordLeaveServerInput,
  success: Schema.Struct({}),
  error: DiscordRpcError,
});

const WsDiscordSearchMessagesRpc = Rpc.make(INTEGRATION_WS_METHODS.discordSearchMessages, {
  payload: DiscordSearchMessagesInput,
  success: DiscordSearchMessagesResult,
  error: DiscordRpcError,
});

const WsDiscordGetThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.discordGetThread, {
  payload: DiscordGetThreadInput,
  success: DiscordThreadContext,
  error: DiscordRpcError,
});

const WsDiscordGetLinkPreviewRpc = Rpc.make(INTEGRATION_WS_METHODS.discordGetLinkPreview, {
  payload: DiscordLinkPreviewInput,
  success: DiscordLinkPreview,
  error: DiscordRpcError,
});

const WsDiscordSubscribeThreadLinksRpc = Rpc.make(
  INTEGRATION_WS_METHODS.discordSubscribeThreadLinks,
  {
    payload: Schema.Struct({}),
    success: DiscordThreadLinks,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

const WsDiscordLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.discordLinkThread, {
  payload: DiscordLinkThreadInput,
  success: DiscordThreadLink,
  error: DiscordRpcError,
});

const WsDiscordUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.discordUnlinkThread, {
  payload: DiscordUnlinkThreadInput,
  success: Schema.Struct({}),
  error: DiscordRpcError,
});

const WsThreadLinkWatchesSubscribeRpc = Rpc.make(
  INTEGRATION_WS_METHODS.threadLinkWatchesSubscribe,
  {
    payload: Schema.Struct({}),
    success: ThreadLinkWatches,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

/** Starts or stops watching a thread's link; returns the watch, or null once stopped. */
const WsThreadLinkWatchSetRpc = Rpc.make(INTEGRATION_WS_METHODS.threadLinkWatchSet, {
  payload: ThreadLinkWatchSetInput,
  success: Schema.NullOr(ThreadLinkWatch),
  error: Schema.Union([ThreadLinkWatchError, EnvironmentAuthorizationError]),
});

const GitHubIssueRpcError = Schema.Union([GitHubIssueError, EnvironmentAuthorizationError]);

const WsGitHubIssuesListRpc = Rpc.make(INTEGRATION_WS_METHODS.githubIssuesList, {
  payload: GitHubListIssuesInput,
  success: GitHubListIssuesResult,
  error: GitHubIssueRpcError,
});

const WsGitHubIssuesGetRpc = Rpc.make(INTEGRATION_WS_METHODS.githubIssuesGet, {
  payload: GitHubGetIssueInput,
  success: GitHubIssueContext,
  error: GitHubIssueRpcError,
});

const WsGitHubIssuesGetSummaryRpc = Rpc.make(INTEGRATION_WS_METHODS.githubIssuesGetSummary, {
  payload: GitHubGetIssueInput,
  success: GitHubIssueSummary,
  error: GitHubIssueRpcError,
});

const WsGitHubRefsGetRpc = Rpc.make(INTEGRATION_WS_METHODS.githubRefsGet, {
  payload: GitHubGetRefInput,
  success: GitHubRefContext,
  error: GitHubIssueRpcError,
});

const WsGitHubIssuesSubscribeThreadLinksRpc = Rpc.make(
  INTEGRATION_WS_METHODS.githubIssuesSubscribeThreadLinks,
  {
    payload: Schema.Struct({}),
    success: GitHubIssueThreadLinks,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

const WsGitHubIssuesLinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.githubIssuesLinkThread, {
  payload: GitHubLinkThreadInput,
  success: GitHubIssueThreadLink,
  error: GitHubIssueRpcError,
});

const WsGitHubIssuesUnlinkThreadRpc = Rpc.make(INTEGRATION_WS_METHODS.githubIssuesUnlinkThread, {
  payload: GitHubUnlinkThreadInput,
  success: Schema.Struct({}),
  error: GitHubIssueRpcError,
});

export const IntegrationRpcGroup = RpcGroup.make(
  WsLinearSubscribeStateRpc,
  WsLinearStartLoginRpc,
  WsLinearCompleteLoginRpc,
  WsLinearCancelLoginRpc,
  WsLinearDisconnectRpc,
  WsLinearListIssuesRpc,
  WsLinearGetIssueRpc,
  WsLinearGetFilterOptionsRpc,
  WsLinearGetIssueSummaryRpc,
  WsLinearGetObjectRpc,
  WsLinearSubscribeThreadLinksRpc,
  WsLinearLinkThreadRpc,
  WsLinearUnlinkThreadRpc,
  WsNotionSubscribeStateRpc,
  WsNotionStartLoginRpc,
  WsNotionCompleteLoginRpc,
  WsNotionCancelLoginRpc,
  WsNotionDisconnectRpc,
  WsNotionSearchPagesRpc,
  WsNotionGetPageRpc,
  WsNotionSubscribeThreadLinksRpc,
  WsNotionLinkThreadRpc,
  WsNotionUnlinkThreadRpc,
  WsGoogleSubscribeStateRpc,
  WsGoogleStartLoginRpc,
  WsGoogleCompleteLoginRpc,
  WsGoogleCancelLoginRpc,
  WsGoogleDisconnectRpc,
  WsGoogleSearchFilesRpc,
  WsGoogleListCalendarsRpc,
  WsGoogleSearchPeopleRpc,
  WsGoogleGetFileRpc,
  WsGoogleSubscribeThreadLinksRpc,
  WsGoogleLinkThreadRpc,
  WsGoogleUnlinkThreadRpc,
  WsGranolaSubscribeStateRpc,
  WsGranolaStartLoginRpc,
  WsGranolaCancelLoginRpc,
  WsGranolaDisconnectRpc,
  WsGranolaSearchNotesRpc,
  WsGranolaGetNoteRpc,
  WsGranolaGetNoteSummaryRpc,
  WsGranolaSubscribeThreadLinksRpc,
  WsGranolaLinkThreadRpc,
  WsGranolaUnlinkThreadRpc,
  WsSlackSubscribeStateRpc,
  WsSlackStartLoginRpc,
  WsSlackCompleteLoginRpc,
  WsSlackCancelLoginRpc,
  WsSlackDisconnectRpc,
  WsSlackSearchMessagesRpc,
  WsSlackSuggestionsRpc,
  WsSlackGetThreadRpc,
  WsSlackGetLinkPreviewRpc,
  WsSlackSubscribeThreadLinksRpc,
  WsSlackLinkThreadRpc,
  WsSlackUnlinkThreadRpc,
  WsDiscordSubscribeStateRpc,
  WsDiscordConnectRpc,
  WsDiscordDisconnectRpc,
  WsDiscordListServersRpc,
  WsDiscordLeaveServerRpc,
  WsDiscordSearchMessagesRpc,
  WsDiscordGetThreadRpc,
  WsDiscordGetLinkPreviewRpc,
  WsDiscordSubscribeThreadLinksRpc,
  WsDiscordLinkThreadRpc,
  WsDiscordUnlinkThreadRpc,
  WsThreadLinkWatchesSubscribeRpc,
  WsThreadLinkWatchSetRpc,
  WsGitHubIssuesListRpc,
  WsGitHubIssuesGetRpc,
  WsGitHubIssuesGetSummaryRpc,
  WsGitHubRefsGetRpc,
  WsGitHubIssuesSubscribeThreadLinksRpc,
  WsGitHubIssuesLinkThreadRpc,
  WsGitHubIssuesUnlinkThreadRpc,
);
