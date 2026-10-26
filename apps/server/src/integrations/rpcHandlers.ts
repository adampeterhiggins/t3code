import { INTEGRATION_WS_METHODS, IntegrationRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as LinearApi from "../linear/LinearApi.ts";
import * as LinearAuth from "../linear/LinearAuth.ts";
import * as LinearThreadLinks from "../linear/LinearThreadLinks.ts";
import * as GranolaApi from "../granola/GranolaApi.ts";
import * as GranolaAuth from "../granola/GranolaAuth.ts";
import * as GranolaThreadLinks from "../granola/GranolaThreadLinks.ts";
import * as NotionApi from "../notion/NotionApi.ts";
import * as GoogleApi from "../google/GoogleApi.ts";
import * as NotionAuth from "../notion/NotionAuth.ts";
import * as GoogleAuth from "../google/GoogleAuth.ts";
import * as SlackApi from "../slack/SlackApi.ts";
import * as SlackAuth from "../slack/SlackAuth.ts";
import * as SlackThreadLinks from "../slack/SlackThreadLinks.ts";
import * as DiscordApi from "../discord/DiscordApi.ts";
import * as DiscordAuth from "../discord/DiscordAuth.ts";
import * as DiscordThreadLinks from "../discord/DiscordThreadLinks.ts";
import * as ThreadLinkWatches from "../threadLinkWatch/ThreadLinkWatches.ts";
import * as NotionThreadLinks from "../notion/NotionThreadLinks.ts";
import * as GoogleThreadLinks from "../google/GoogleThreadLinks.ts";
import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
import * as GitHubIssueThreadLinks from "../githubIssues/GitHubIssueThreadLinks.ts";

export const makeIntegrationRpcHandlers = Effect.fn("IntegrationRpc.handlers")(function* () {
  const linearAuth = yield* LinearAuth.LinearAuth;
  const linearApi = yield* LinearApi.LinearApi;
  const linearThreadLinks = yield* LinearThreadLinks.LinearThreadLinks;
  const slackAuth = yield* SlackAuth.SlackAuth;
  const slackApi = yield* SlackApi.SlackApi;
  const notionApi = yield* NotionApi.NotionApi;
  const googleApi = yield* GoogleApi.GoogleApi;
  const notionAuth = yield* NotionAuth.NotionAuth;
  const googleAuth = yield* GoogleAuth.GoogleAuth;
  const notionThreadLinks = yield* NotionThreadLinks.NotionThreadLinks;
  const googleThreadLinks = yield* GoogleThreadLinks.GoogleThreadLinks;
  const granolaApi = yield* GranolaApi.GranolaApi;
  const granolaAuth = yield* GranolaAuth.GranolaAuth;
  const granolaThreadLinks = yield* GranolaThreadLinks.GranolaThreadLinks;
  const slackThreadLinks = yield* SlackThreadLinks.SlackThreadLinks;
  const discordAuth = yield* DiscordAuth.DiscordAuth;
  const discordApi = yield* DiscordApi.DiscordApi;
  const discordThreadLinks = yield* DiscordThreadLinks.DiscordThreadLinks;
  const threadLinkWatches = yield* ThreadLinkWatches.ThreadLinkWatches;
  const githubIssues = yield* GitHubIssues.GitHubIssues;
  const githubIssueThreadLinks = yield* GitHubIssueThreadLinks.GitHubIssueThreadLinks;
  return IntegrationRpcGroup.of({
    [INTEGRATION_WS_METHODS.linearSubscribeState]: (_input) => linearAuth.state,
    [INTEGRATION_WS_METHODS.linearStartLogin]: (_input) => linearAuth.startLogin,
    [INTEGRATION_WS_METHODS.linearCompleteLogin]: (input) => linearAuth.completeLogin(input),
    [INTEGRATION_WS_METHODS.linearCancelLogin]: (input) => linearAuth.cancelLogin(input),
    [INTEGRATION_WS_METHODS.linearDisconnect]: (_input) => linearAuth.disconnect,
    [INTEGRATION_WS_METHODS.linearListIssues]: (input) => linearApi.listIssues(input),
    [INTEGRATION_WS_METHODS.linearGetFilterOptions]: (_input) => linearApi.getFilterOptions,
    [INTEGRATION_WS_METHODS.linearGetIssue]: (input) => linearApi.getIssue(input),
    [INTEGRATION_WS_METHODS.linearGetIssueSummary]: (input) => linearApi.getIssueSummary(input),
    [INTEGRATION_WS_METHODS.linearGetObject]: (input) => linearApi.getObject(input),
    [INTEGRATION_WS_METHODS.linearSubscribeThreadLinks]: (_input) => linearThreadLinks.links,
    [INTEGRATION_WS_METHODS.linearLinkThread]: (input) => linearThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.linearUnlinkThread]: (input) =>
      linearThreadLinks.unlink(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.notionSubscribeState]: (_input) => notionAuth.state,
    [INTEGRATION_WS_METHODS.notionStartLogin]: (input) => notionAuth.startLogin(input),
    [INTEGRATION_WS_METHODS.notionCompleteLogin]: (input) => notionAuth.completeLogin(input),
    [INTEGRATION_WS_METHODS.notionCancelLogin]: (input) => notionAuth.cancelLogin(input),
    [INTEGRATION_WS_METHODS.notionDisconnect]: (_input) => notionAuth.disconnect,
    [INTEGRATION_WS_METHODS.notionSearchPages]: (input) => notionApi.searchPages(input),
    [INTEGRATION_WS_METHODS.notionGetPage]: (input) => notionApi.getPage(input),
    [INTEGRATION_WS_METHODS.notionSubscribeThreadLinks]: (_input) => notionThreadLinks.links,
    [INTEGRATION_WS_METHODS.notionLinkThread]: (input) => notionThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.notionUnlinkThread]: (input) =>
      notionThreadLinks.unlink(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.googleSubscribeState]: (_input) => googleAuth.state,
    [INTEGRATION_WS_METHODS.googleStartLogin]: (input) => googleAuth.startLogin(input),
    [INTEGRATION_WS_METHODS.googleCompleteLogin]: (input) => googleAuth.completeLogin(input),
    [INTEGRATION_WS_METHODS.googleCancelLogin]: (input) => googleAuth.cancelLogin(input),
    [INTEGRATION_WS_METHODS.googleDisconnect]: (_input) => googleAuth.disconnect,
    [INTEGRATION_WS_METHODS.googleSearchFiles]: (input) => googleApi.searchFiles(input),
    [INTEGRATION_WS_METHODS.googleListCalendars]: (_input) => googleApi.listCalendars,
    [INTEGRATION_WS_METHODS.googleSearchPeople]: (input) => googleApi.searchPeople(input),
    [INTEGRATION_WS_METHODS.googleGetFile]: (input) => googleApi.getFile(input),
    [INTEGRATION_WS_METHODS.googleSubscribeThreadLinks]: (_input) => googleThreadLinks.links,
    [INTEGRATION_WS_METHODS.googleLinkThread]: (input) => googleThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.googleUnlinkThread]: (input) =>
      googleThreadLinks.unlink(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.granolaSubscribeState]: (_input) => granolaAuth.state,
    [INTEGRATION_WS_METHODS.granolaStartLogin]: (_input) => granolaAuth.startLogin,
    [INTEGRATION_WS_METHODS.granolaCancelLogin]: (input) => granolaAuth.cancelLogin(input),
    [INTEGRATION_WS_METHODS.granolaDisconnect]: (_input) => granolaAuth.disconnect,
    [INTEGRATION_WS_METHODS.granolaSearchNotes]: (input) => granolaApi.searchNotes(input),
    [INTEGRATION_WS_METHODS.granolaGetNote]: (input) => granolaApi.getNote(input),
    [INTEGRATION_WS_METHODS.granolaGetNoteSummary]: (input) => granolaApi.getNoteSummary(input),
    [INTEGRATION_WS_METHODS.granolaSubscribeThreadLinks]: (_input) => granolaThreadLinks.links,
    [INTEGRATION_WS_METHODS.granolaLinkThread]: (input) => granolaThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.granolaUnlinkThread]: (input) =>
      granolaThreadLinks.unlink(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.slackSubscribeState]: (_input) => slackAuth.state,
    [INTEGRATION_WS_METHODS.slackStartLogin]: (input) => slackAuth.startLogin(input),
    [INTEGRATION_WS_METHODS.slackCompleteLogin]: (input) => slackAuth.completeLogin(input),
    [INTEGRATION_WS_METHODS.slackCancelLogin]: (input) => slackAuth.cancelLogin(input),
    [INTEGRATION_WS_METHODS.slackDisconnect]: (_input) => slackAuth.disconnect,
    [INTEGRATION_WS_METHODS.slackSearchMessages]: (input) => slackApi.searchMessages(input),
    [INTEGRATION_WS_METHODS.slackSuggestions]: (_input) => slackApi.suggestions,
    [INTEGRATION_WS_METHODS.slackGetThread]: (input) => slackApi.getThread(input),
    [INTEGRATION_WS_METHODS.slackGetLinkPreview]: (input) => slackApi.getLinkPreview(input),
    [INTEGRATION_WS_METHODS.slackSubscribeThreadLinks]: (_input) => slackThreadLinks.links,
    [INTEGRATION_WS_METHODS.slackLinkThread]: (input) => slackThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.slackUnlinkThread]: (input) =>
      slackThreadLinks.unlink(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.discordSubscribeState]: (_input) => discordAuth.state,
    [INTEGRATION_WS_METHODS.discordConnect]: (input) => discordAuth.connect(input),
    [INTEGRATION_WS_METHODS.discordDisconnect]: (_input) => discordAuth.disconnect,
    [INTEGRATION_WS_METHODS.discordListServers]: (_input) => discordApi.listServers,
    [INTEGRATION_WS_METHODS.discordLeaveServer]: (input) =>
      discordApi.leaveServer(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.discordSearchMessages]: (input) => discordApi.searchMessages(input),
    [INTEGRATION_WS_METHODS.discordGetThread]: (input) => discordApi.getThread(input),
    [INTEGRATION_WS_METHODS.discordGetLinkPreview]: (input) => discordApi.getLinkPreview(input),
    [INTEGRATION_WS_METHODS.discordSubscribeThreadLinks]: (_input) => discordThreadLinks.links,
    [INTEGRATION_WS_METHODS.discordLinkThread]: (input) => discordThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.discordUnlinkThread]: (input) =>
      discordThreadLinks.unlink(input).pipe(Effect.as({})),
    [INTEGRATION_WS_METHODS.threadLinkWatchesSubscribe]: (_input) => threadLinkWatches.watches,
    [INTEGRATION_WS_METHODS.threadLinkWatchSet]: (input) => threadLinkWatches.set(input),
    [INTEGRATION_WS_METHODS.githubIssuesList]: (input) => githubIssues.listIssues(input),
    [INTEGRATION_WS_METHODS.githubIssuesGet]: (input) => githubIssues.getIssue(input),
    [INTEGRATION_WS_METHODS.githubIssuesGetSummary]: (input) => githubIssues.getIssueSummary(input),
    [INTEGRATION_WS_METHODS.githubRefsGet]: (input) => githubIssues.getRef(input),
    [INTEGRATION_WS_METHODS.githubIssuesSubscribeThreadLinks]: (_input) =>
      githubIssueThreadLinks.links,
    [INTEGRATION_WS_METHODS.githubIssuesLinkThread]: (input) => githubIssueThreadLinks.link(input),
    [INTEGRATION_WS_METHODS.githubIssuesUnlinkThread]: (input) =>
      githubIssueThreadLinks.unlink(input).pipe(Effect.as({})),
  });
});
