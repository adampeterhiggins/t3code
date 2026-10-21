import {
  type ComposerContextRecord,
  type KnownComposerContextRecord,
  DiscordGetThreadInput,
  GitHubGetIssueInput,
  GitHubGetRefInput,
  GranolaGetNoteInput,
  LinearGetIssueInput,
  LinearGetObjectInput,
  NotionGetPageInput,
  type OrchestrationMessageContext,
  OrchestratorMcpFailure,
  SlackGetThreadInput,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import {
  type ComposerObjectLink,
  locateComposerObjectLink,
  parseComposerObjectLink,
} from "@t3tools/shared/composerObjectLinks";
import {
  discordThreadContextRecord,
  gitHubIssueContextRecord,
  gitHubRefContextRecord,
  granolaNoteContextRecord,
  linearIssueContextRecord,
  linearObjectContextRecord,
  notionPageContextRecord,
  promptLinkContextRecord,
  repositoryContextRecord,
  slackThreadContextRecord,
} from "@t3tools/shared/integrationContextRecords";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DiscordApi from "../discord/DiscordApi.ts";
import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
import * as GranolaApi from "../granola/GranolaApi.ts";
import * as LinearApi from "../linear/LinearApi.ts";
import * as NotionApi from "../notion/NotionApi.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackApi from "../slack/SlackApi.ts";

export interface AttachedContextLinks {
  /** The message with each link's chip reference in place of the link, or appended. */
  readonly text: string;
  readonly context: OrchestrationMessageContext | undefined;
}

/**
 * Integration context an agent attaches over MCP: the links a user would paste into the
 * composer, read through the same integrations and snapshotted into the same chip records.
 */
export class McpContextLinks extends Context.Service<
  McpContextLinks,
  {
    readonly attach: (input: {
      readonly text: string;
      readonly links: ReadonlyArray<string> | undefined;
    }) => Effect.Effect<AttachedContextLinks, OrchestratorMcpFailure>;
    /** Reads one link into the chip record a composer paste would make, without sending it. */
    readonly read: (
      url: string,
    ) => Effect.Effect<KnownComposerContextRecord, OrchestratorMcpFailure>;
  }
>()("t3/mcp/McpContextLinks") {}

const decodeLinearGetIssueInput = Schema.decodeUnknownEffect(LinearGetIssueInput);
const decodeLinearGetObjectInput = Schema.decodeUnknownEffect(LinearGetObjectInput);
const decodeGitHubGetIssueInput = Schema.decodeUnknownEffect(GitHubGetIssueInput);
const decodeGitHubGetRefInput = Schema.decodeUnknownEffect(GitHubGetRefInput);
const decodeNotionGetPageInput = Schema.decodeUnknownEffect(NotionGetPageInput);
const decodeGranolaGetNoteInput = Schema.decodeUnknownEffect(GranolaGetNoteInput);
const decodeSlackGetThreadInput = Schema.decodeUnknownEffect(SlackGetThreadInput);
const decodeDiscordGetThreadInput = Schema.decodeUnknownEffect(DiscordGetThreadInput);

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

type Verb = "attach" | "read";

const unreadable = (verb: Verb, url: string) => (error: { readonly message: string }) =>
  invalid(`Could not ${verb} ${url}: ${error.message}`);

const UNRECOGNIZED_LINK =
  "Use a Slack or Discord message, Notion page, Granola note, Linear issue, project, document, or initiative, GitHub issue, GitHub repository, GitHub release, tag, branch, or commit, or T3 Code prompt link.";

export const make = Effect.gen(function* () {
  const linear = yield* LinearApi.LinearApi;
  const notion = yield* NotionApi.NotionApi;
  const granola = yield* GranolaApi.GranolaApi;
  const slack = yield* SlackApi.SlackApi;
  const discord = yield* DiscordApi.DiscordApi;
  const gitHubIssues = yield* GitHubIssues.GitHubIssues;
  const settings = yield* ServerSettings.ServerSettingsService;

  const integrationEnabled = (
    key:
      | "enableSlackIntegration"
      | "enableDiscordIntegration"
      | "enableNotionIntegration"
      | "enableGranolaIntegration",
  ) =>
    settings.getSettings.pipe(
      Effect.map((current) => current[key]),
      Effect.orElseSucceed(() => true),
    );

  const resolve = (
    link: ComposerObjectLink,
    verb: Verb,
  ): Effect.Effect<KnownComposerContextRecord, OrchestratorMcpFailure> => {
    const malformed = (url: string) => () =>
      invalid(`Could not ${verb} ${url}: the link is malformed.`);
    const { url } = link;
    switch (link.kind) {
      case "linear-issue":
        return decodeLinearGetIssueInput({ id: link.identifier }).pipe(
          Effect.mapError(malformed(url)),
          Effect.flatMap((input) =>
            linear.getIssue(input).pipe(Effect.mapError(unreadable(verb, url))),
          ),
          Effect.map(linearIssueContextRecord),
        );
      case "linear-object":
        return decodeLinearGetObjectInput({ objectType: link.objectType, id: link.slugId }).pipe(
          Effect.mapError(malformed(url)),
          Effect.flatMap((input) =>
            linear.getObject(input).pipe(Effect.mapError(unreadable(verb, url))),
          ),
          Effect.map(linearObjectContextRecord),
        );
      case "github-issue":
        return decodeGitHubGetIssueInput({ url }).pipe(
          Effect.mapError(malformed(url)),
          Effect.flatMap((input) =>
            gitHubIssues.getIssue(input).pipe(Effect.mapError(unreadable(verb, url))),
          ),
          Effect.map(gitHubIssueContextRecord),
        );
      case "github-ref":
        return decodeGitHubGetRefInput({ url }).pipe(
          Effect.mapError(malformed(url)),
          Effect.flatMap((input) =>
            gitHubIssues.getRef(input).pipe(Effect.mapError(unreadable(verb, url))),
          ),
          Effect.map(gitHubRefContextRecord),
        );
      case "notion-page":
        return Effect.gen(function* () {
          if (!(yield* integrationEnabled("enableNotionIntegration")))
            return yield* invalid(
              `Could not ${verb} ${url}: the Notion integration is turned off in Settings → Integrations.`,
            );
          const input = yield* decodeNotionGetPageInput({
            id: link.pageId,
          }).pipe(Effect.mapError(malformed(url)));
          const page = yield* notion
            .getPage(input)
            .pipe(
              Effect.mapError((error) =>
                error.reason === "not-found"
                  ? invalid(
                      `Could not ${verb} ${url}: Notion has not shared this page with T3 Code. The user can add the T3 Code connection from the page's ••• menu → Connections.`,
                    )
                  : unreadable(verb, url)(error),
              ),
            );
          return notionPageContextRecord(page);
        });
      case "granola-note":
        return Effect.gen(function* () {
          if (!(yield* integrationEnabled("enableGranolaIntegration")))
            return yield* invalid(
              `Could not ${verb} ${url}: the Granola integration is turned off in Settings → Integrations.`,
            );
          const input = yield* decodeGranolaGetNoteInput({ id: link.noteId }).pipe(
            Effect.mapError(malformed(url)),
          );
          const note = yield* granola.getNote(input).pipe(Effect.mapError(unreadable(verb, url)));
          return granolaNoteContextRecord(note);
        });
      case "slack-message":
        return Effect.gen(function* () {
          if (!(yield* integrationEnabled("enableSlackIntegration")))
            return yield* invalid(
              `Could not ${verb} ${url}: the Slack integration is turned off in Settings → Integrations.`,
            );
          const input = yield* decodeSlackGetThreadInput({
            channelId: link.channelId,
            ts: link.ts,
            ...(link.threadTs === null ? {} : { threadTs: link.threadTs }),
            url,
            scope: "thread",
          }).pipe(Effect.mapError(malformed(url)));
          const thread = yield* slack.getThread(input).pipe(Effect.mapError(unreadable(verb, url)));
          return slackThreadContextRecord(thread);
        });
      case "discord-message":
        return Effect.gen(function* () {
          if (!(yield* integrationEnabled("enableDiscordIntegration")))
            return yield* invalid(
              `Could not ${verb} ${url}: the Discord integration is turned off in Settings → Integrations.`,
            );
          const input = yield* decodeDiscordGetThreadInput({
            guildId: link.guildId,
            channelId: link.channelId,
            messageId: link.messageId,
            url,
            scope: "thread",
          }).pipe(Effect.mapError(malformed(url)));
          const thread = yield* discord
            .getThread(input)
            .pipe(Effect.mapError(unreadable(verb, url)));
          return discordThreadContextRecord(thread);
        });
      case "repository":
        return verb === "read"
          ? Effect.fail(
              invalid(
                `Repository links are cloned rather than read: ${url}. Clone it, or attach it to a message with contextLinks.`,
              ),
            )
          : Effect.succeed(repositoryContextRecord(link));
      case "prompt-link":
        return Effect.succeed(promptLinkContextRecord(link));
      case "pull-request":
        return Effect.fail(
          invalid(
            verb === "read"
              ? `Pull request links cannot be read here: ${url}. Use gh or the pull request tools instead.`
              : `Pull request links cannot be attached as context: ${url}. Leave the link in the message text instead.`,
          ),
        );
    }
  };

  const attach = Effect.fn("McpContextLinks.attach")(function* (
    input: Parameters<McpContextLinks["Service"]["attach"]>[0],
  ) {
    const links = [...new Set(input.links ?? [])];
    if (links.length === 0) return { text: input.text, context: undefined };
    const parsed = yield* Effect.forEach(links, (url) => {
      const link = parseComposerObjectLink(url);
      return link === null
        ? Effect.fail(invalid(`${url} is not a link T3 Code can attach. ${UNRECOGNIZED_LINK}`))
        : Effect.succeed(link);
    });
    const records = yield* Effect.forEach(parsed, (link) => resolve(link, "attach"), {
      concurrency: 4,
    });

    let text = input.text;
    const appended: string[] = [];
    const recordsById = new Map<string, ComposerContextRecord>();
    for (const [index, record] of records.entries()) {
      recordsById.set(record.contextId, record);
      const reference = formatComposerContextReference(record);
      // A link the message already mentions becomes its chip there, as a paste would.
      const at = locateComposerObjectLink(text, parsed[index]!.url, 0);
      if (at === null) appended.push(reference);
      else text = text.slice(0, at.start) + reference + text.slice(at.end);
    }
    if (appended.length > 0)
      text = [text, appended.join("\n")].filter((part) => part.length > 0).join("\n\n");
    return { text, context: { version: 1 as const, records: [...recordsById.values()] } };
  });

  const read: McpContextLinks["Service"]["read"] = (url) => {
    const link = parseComposerObjectLink(url);
    return link === null
      ? Effect.fail(invalid(`${url} is not a link T3 Code can read. ${UNRECOGNIZED_LINK}`))
      : resolve(link, "read");
  };

  return McpContextLinks.of({ attach, read });
});

export const layer: Layer.Layer<
  McpContextLinks,
  never,
  | LinearApi.LinearApi
  | NotionApi.NotionApi
  | GranolaApi.GranolaApi
  | SlackApi.SlackApi
  | DiscordApi.DiscordApi
  | GitHubIssues.GitHubIssues
  | ServerSettings.ServerSettingsService
> = Layer.effect(McpContextLinks, make);
