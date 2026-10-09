import {
  type ComposerContextRecord,
  GitHubGetIssueInput,
  LinearGetIssueInput,
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
  gitHubIssueContextRecord,
  linearIssueContextRecord,
  notionPageContextRecord,
  repositoryContextRecord,
  slackThreadContextRecord,
} from "@t3tools/shared/integrationContextRecords";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
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
  }
>()("t3/mcp/McpContextLinks") {}

const decodeLinearGetIssueInput = Schema.decodeUnknownEffect(LinearGetIssueInput);
const decodeGitHubGetIssueInput = Schema.decodeUnknownEffect(GitHubGetIssueInput);
const decodeNotionGetPageInput = Schema.decodeUnknownEffect(NotionGetPageInput);
const decodeSlackGetThreadInput = Schema.decodeUnknownEffect(SlackGetThreadInput);

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const unreadable = (url: string) => (error: { readonly message: string }) =>
  invalid(`Could not attach ${url}: ${error.message}`);

export const make = Effect.gen(function* () {
  const linear = yield* LinearApi.LinearApi;
  const notion = yield* NotionApi.NotionApi;
  const slack = yield* SlackApi.SlackApi;
  const gitHubIssues = yield* GitHubIssues.GitHubIssues;
  const settings = yield* ServerSettings.ServerSettingsService;

  const integrationEnabled = (key: "enableSlackIntegration" | "enableNotionIntegration") =>
    settings.getSettings.pipe(
      Effect.map((current) => current[key]),
      Effect.orElseSucceed(() => true),
    );

  const malformed = (url: string) => () =>
    invalid(`Could not attach ${url}: the link is malformed.`);

  const resolve = (
    link: ComposerObjectLink,
  ): Effect.Effect<ComposerContextRecord, OrchestratorMcpFailure> => {
    const { url } = link;
    switch (link.kind) {
      case "linear-issue":
        return decodeLinearGetIssueInput({ id: link.identifier }).pipe(
          Effect.mapError(malformed(url)),
          Effect.flatMap((input) => linear.getIssue(input).pipe(Effect.mapError(unreadable(url)))),
          Effect.map(linearIssueContextRecord),
        );
      case "github-issue":
        return decodeGitHubGetIssueInput({ url }).pipe(
          Effect.mapError(malformed(url)),
          Effect.flatMap((input) =>
            gitHubIssues.getIssue(input).pipe(Effect.mapError(unreadable(url))),
          ),
          Effect.map(gitHubIssueContextRecord),
        );
      case "notion-page":
        return Effect.gen(function* () {
          if (!(yield* integrationEnabled("enableNotionIntegration")))
            return yield* invalid(
              `Could not attach ${url}: the Notion integration is turned off in Settings → Integrations.`,
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
                      `Could not attach ${url}: Notion has not shared this page with T3 Code. The user can add the T3 Code connection from the page's ••• menu → Connections.`,
                    )
                  : unreadable(url)(error),
              ),
            );
          return notionPageContextRecord(page);
        });
      case "slack-message":
        return Effect.gen(function* () {
          if (!(yield* integrationEnabled("enableSlackIntegration")))
            return yield* invalid(
              `Could not attach ${url}: the Slack integration is turned off in Settings → Integrations.`,
            );
          const input = yield* decodeSlackGetThreadInput({
            channelId: link.channelId,
            ts: link.ts,
            ...(link.threadTs === null ? {} : { threadTs: link.threadTs }),
            url,
            scope: "thread",
          }).pipe(Effect.mapError(malformed(url)));
          const thread = yield* slack.getThread(input).pipe(Effect.mapError(unreadable(url)));
          return slackThreadContextRecord(thread);
        });
      case "repository":
        return Effect.succeed(repositoryContextRecord(link));
      case "pull-request":
        return Effect.fail(
          invalid(
            `Pull request links cannot be attached as context: ${url}. Leave the link in the message text instead.`,
          ),
        );
    }
  };

  const attach: McpContextLinks["Service"]["attach"] = (input) =>
    Effect.gen(function* () {
      const links = [...new Set(input.links ?? [])];
      if (links.length === 0) return { text: input.text, context: undefined };
      const parsed = yield* Effect.forEach(links, (url) => {
        const link = parseComposerObjectLink(url);
        return link === null
          ? Effect.fail(
              invalid(
                `${url} is not a link T3 Code can attach. Use a Slack message, Notion page, Linear issue, GitHub issue, or GitHub repository link.`,
              ),
            )
          : Effect.succeed(link);
      });
      const records = yield* Effect.forEach(parsed, resolve, { concurrency: 4 });

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
      return { text, context: { version: 1, records: [...recordsById.values()] } };
    });

  return McpContextLinks.of({ attach });
});

export const layer: Layer.Layer<
  McpContextLinks,
  never,
  | LinearApi.LinearApi
  | NotionApi.NotionApi
  | SlackApi.SlackApi
  | GitHubIssues.GitHubIssues
  | ServerSettings.ServerSettingsService
> = Layer.effect(McpContextLinks, make);
