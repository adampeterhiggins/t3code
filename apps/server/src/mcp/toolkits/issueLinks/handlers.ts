import { OrchestratorMcpFailure, type ThreadId, type ThreadLinkKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { formatComposerContextProviderPayload } from "@t3tools/shared/composerContextReferences";
import { parseComposerObjectLink } from "@t3tools/source-control-definitions/composerObjectLinks";

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
import * as ThreadLinkWatches from "../../../threadLinkWatch/ThreadLinkWatches.ts";
import * as McpContextLinks from "../../McpContextLinks.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import {
  IssueLinkThreadNotFoundError,
  IssueLinkThreadRequiredError,
  IssueLinksToolkit,
  NoLinkedLinearIssueError,
} from "./tools.ts";

const NO_FILTERS = {
  assigneeIds: [],
  teamIds: [],
  projectIds: [],
  milestoneIds: [],
  stateNames: [],
  priorities: [],
  labelNames: [],
  includeClosed: false,
};

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const linear = yield* LinearThreadLinks.LinearThreadLinks;
  const github = yield* GitHubIssueThreadLinks.GitHubIssueThreadLinks;
  const linearApi = yield* LinearApi.LinearApi;
  const slack = yield* SlackThreadLinks.SlackThreadLinks;
  const discord = yield* DiscordThreadLinks.DiscordThreadLinks;
  const notion = yield* NotionThreadLinks.NotionThreadLinks;
  const google = yield* GoogleThreadLinks.GoogleThreadLinks;
  const granola = yield* GranolaThreadLinks.GranolaThreadLinks;
  const contextLinks = yield* McpContextLinks.McpContextLinks;
  const slackApi = yield* SlackApi.SlackApi;
  const notionApi = yield* NotionApi.NotionApi;
  const googleApi = yield* GoogleApi.GoogleApi;
  const settings = yield* ServerSettings.ServerSettingsService;
  const watches = yield* ThreadLinkWatches.ThreadLinkWatches;

  /** The search tools honour the same off switch as the composer and contextLinks. */
  const requireIntegrationOn = (
    key:
      | "enableSlackIntegration"
      | "enableDiscordIntegration"
      | "enableNotionIntegration"
      | "enableGoogleIntegration"
      | "enableGranolaIntegration",
    name: string,
  ) =>
    settings.getSettings.pipe(
      Effect.map((current) => current[key]),
      Effect.orElseSucceed(() => true),
      Effect.flatMap((enabled) =>
        enabled
          ? Effect.void
          : Effect.fail(
              new OrchestratorMcpFailure({
                code: "invalid_request",
                message: `The ${name} integration is turned off in Settings → Integrations.`,
              }),
            ),
      ),
    );

  /**
   * The thread a call targets: `requested`, or the caller's own. Issue links ride the
   * pull-requests capability, since they are the same kind of thread-to-work link.
   */
  const requireThread = Effect.fnUntraced(function* (requested: ThreadId | undefined) {
    const scope = yield* McpInvocationContext.requireMcpCapability("pull-requests");
    const threadId = requested ?? scope.thread?.threadId;
    if (threadId === undefined) {
      return yield* new IssueLinkThreadRequiredError();
    }
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(unavailable));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new IssueLinkThreadNotFoundError({ threadId });
    }
    return thread.id;
  });

  /** Reads that reach an integration through the environment's connection rather than a thread. */
  const requireIntegrationRead = McpInvocationContext.requireMcpCapability("pull-requests");

  const linkedUrl = (threadId: ThreadId, kind: ThreadLinkKind) => {
    const links: Record<
      ThreadLinkKind,
      { readonly forThread: (id: ThreadId) => Effect.Effect<{ readonly url: string } | undefined> }
    > = { linear, github, slack, discord, notion, google, granola };
    return links[kind]
      .forThread(threadId)
      .pipe(Effect.map((link): string | null => link?.url ?? null));
  };

  const linkByUrl = Effect.fn("IssueLinks.linkByUrl")(function* (threadId: ThreadId, url: string) {
    const link = parseComposerObjectLink(url);
    const replaced = (before: string | null, linked: { readonly url: string }) =>
      before === linked.url ? null : before;
    switch (link?.kind) {
      case "linear-issue": {
        const result = yield* linear.linkWithReplacement({ threadId, issueId: link.identifier });
        return {
          kind: "linear" as const,
          url: result.link.url,
          title: `${result.link.identifier} ${result.link.title}`,
          replacedUrl: result.replacedUrl,
        };
      }
      case "github-issue": {
        const result = yield* github.linkWithReplacement({ threadId, url: link.url });
        return {
          kind: "github" as const,
          url: result.link.url,
          title: `${result.link.repository}#${result.link.number} ${result.link.title}`,
          replacedUrl: result.replacedUrl,
        };
      }
      case "slack-message": {
        yield* requireIntegrationOn("enableSlackIntegration", "Slack");
        const before = yield* linkedUrl(threadId, "slack");
        const linked = yield* slack.link({
          threadId,
          channelId: link.channelId,
          ts: link.ts,
          ...(link.threadTs === null ? {} : { threadTs: link.threadTs }),
          url: link.url,
        });
        return {
          kind: "slack" as const,
          url: linked.url,
          title: linked.title,
          replacedUrl: replaced(before, linked),
        };
      }
      case "discord-message": {
        yield* requireIntegrationOn("enableDiscordIntegration", "Discord");
        const before = yield* linkedUrl(threadId, "discord");
        const linked = yield* discord.link({
          threadId,
          guildId: link.guildId,
          channelId: link.channelId,
          messageId: link.messageId,
          url: link.url,
        });
        return {
          kind: "discord" as const,
          url: linked.url,
          title: linked.title,
          replacedUrl: replaced(before, linked),
        };
      }
      case "notion-page": {
        yield* requireIntegrationOn("enableNotionIntegration", "Notion");
        const before = yield* linkedUrl(threadId, "notion");
        const linked = yield* notion.link({ threadId, pageId: link.pageId });
        return {
          kind: "notion" as const,
          url: linked.url,
          title: linked.title,
          replacedUrl: replaced(before, linked),
        };
      }
      case "google-file": {
        yield* requireIntegrationOn("enableGoogleIntegration", "Google");
        const before = yield* linkedUrl(threadId, "google");
        const linked = yield* google.link({ threadId, fileId: link.url });
        return {
          kind: "google" as const,
          url: linked.url,
          title: linked.title,
          replacedUrl: replaced(before, linked),
        };
      }
      case "granola-note": {
        yield* requireIntegrationOn("enableGranolaIntegration", "Granola");
        const before = yield* linkedUrl(threadId, "granola");
        const linked = yield* granola.link({ threadId, noteId: link.noteId });
        return {
          kind: "granola" as const,
          url: linked.url,
          title: linked.title,
          replacedUrl: replaced(before, linked),
        };
      }
      default:
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `Cannot link ${url}. Use a Slack or Discord message, Notion page, Google file or event, Granola note, Linear issue, or GitHub issue link; for pull requests use link_pull_request.`,
        });
    }
  });

  const unlinkKind = Effect.fn("IssueLinks.unlinkKind")(function* (
    threadId: ThreadId,
    kind: ThreadLinkKind,
  ) {
    const wasLinked = (yield* linkedUrl(threadId, kind)) !== null;
    switch (kind) {
      case "linear":
        yield* linear.unlink({ threadId });
        break;
      case "github":
        yield* github.unlink({ threadId });
        break;
      case "slack":
        yield* slack.unlink({ threadId });
        break;
      case "discord":
        yield* discord.unlink({ threadId });
        break;
      case "notion":
        yield* notion.unlink({ threadId });
        break;
      case "google":
        yield* google.unlink({ threadId });
        break;
      case "granola":
        yield* granola.unlink({ threadId });
        break;
    }
    yield* watches.unwatch(threadId, kind);
    return { wasLinked };
  });

  /** A tool that changes `threadId`, or the caller's own thread when it is omitted. */
  const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
    handle: (params: P) => Effect.Effect<A, E, R>,
  ) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

  return {
    link_linear_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) =>
          linear.linkWithReplacement({ threadId, issueId: input.issue }),
        ),
      ),
    ),
    unlink_linear_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => linear.unlink({ threadId })),
        Effect.map((wasLinked) => ({ wasLinked })),
      ),
    ),
    link_github_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => github.linkWithReplacement({ threadId, url: input.url })),
      ),
    ),
    unlink_github_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => github.unlink({ threadId })),
        Effect.map((wasLinked) => ({ wasLinked })),
      ),
    ),
    list_thread_links: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const threadId = yield* requireThread(input.threadId);
        return {
          linear: (yield* linear.forThread(threadId)) ?? null,
          github: (yield* github.forThread(threadId)) ?? null,
          slack: (yield* slack.forThread(threadId)) ?? null,
          discord: (yield* discord.forThread(threadId)) ?? null,
          notion: (yield* notion.forThread(threadId)) ?? null,
          google: (yield* google.forThread(threadId)) ?? null,
          granola: (yield* granola.forThread(threadId)) ?? null,
          watches: yield* watches.forThread(threadId),
        };
      }),
    ),
    link_thread_link: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => linkByUrl(threadId, input.url)),
      ),
    ),
    unlink_thread_link: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => unlinkKind(threadId, input.kind)),
      ),
    ),
    watch_thread_link: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => watches.watch(threadId, input.kind)),
      ),
    ),
    unwatch_thread_link: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => watches.unwatch(threadId, input.kind)),
        Effect.map((wasWatching) => ({ wasWatching })),
      ),
    ),
    read_context_link: McpToolAccess.reads((input) =>
      requireIntegrationRead.pipe(
        Effect.flatMap(() => contextLinks.read(input.url)),
        Effect.map((record) => ({
          kind: record.kind,
          url: input.url,
          text: formatComposerContextProviderPayload(record),
        })),
      ),
    ),
    read_linear_issue: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.issue !== undefined) {
          yield* requireIntegrationRead;
          return yield* linearApi.getIssue({ id: input.issue });
        }
        const threadId = yield* requireThread(input.threadId);
        const link = yield* linear.forThread(threadId);
        if (link === undefined) {
          return yield* new NoLinkedLinearIssueError({ threadId });
        }
        return yield* linearApi.getIssue({ id: link.issueId });
      }),
    ),
    search_linear_issues: McpToolAccess.reads((input) =>
      requireIntegrationRead.pipe(
        Effect.flatMap(() =>
          linearApi.listIssues({
            query: input.query,
            filters: input.filters === undefined ? undefined : { ...NO_FILTERS, ...input.filters },
            sort: input.sort,
          }),
        ),
      ),
    ),
    list_linear_filter_options: McpToolAccess.reads(() =>
      requireIntegrationRead.pipe(Effect.flatMap(() => linearApi.getFilterOptions)),
    ),
    search_slack_messages: McpToolAccess.reads((input) =>
      requireIntegrationRead.pipe(
        Effect.andThen(requireIntegrationOn("enableSlackIntegration", "Slack")),
        Effect.andThen(slackApi.searchMessages({ query: input.query })),
      ),
    ),
    search_notion_pages: McpToolAccess.reads((input) =>
      requireIntegrationRead.pipe(
        Effect.andThen(requireIntegrationOn("enableNotionIntegration", "Notion")),
        Effect.andThen(notionApi.searchPages({ query: input.query })),
      ),
    ),
    search_google_files: McpToolAccess.reads((input) =>
      requireIntegrationRead.pipe(
        Effect.andThen(requireIntegrationOn("enableGoogleIntegration", "Google")),
        Effect.andThen(googleApi.searchFiles(input)),
      ),
    ),
    list_google_calendars: McpToolAccess.reads(() =>
      requireIntegrationRead.pipe(
        Effect.andThen(requireIntegrationOn("enableGoogleIntegration", "Google")),
        Effect.andThen(googleApi.listCalendars),
      ),
    ),
    search_google_people: McpToolAccess.reads((input) =>
      requireIntegrationRead.pipe(
        Effect.andThen(requireIntegrationOn("enableGoogleIntegration", "Google")),
        Effect.andThen(googleApi.searchPeople({ query: input.query.trim() })),
      ),
    ),
  } satisfies McpToolAccess.Handlers<typeof IssueLinksToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(IssueLinksToolkit, make);
