import { assert, it } from "@effect/vitest";
import {
  type DiscordGetThreadInput,
  type DiscordThreadContext,
  type LinearGetObjectInput,
  type LinearIssueContext,
  NotionError,
  GoogleError,
  type SlackGetThreadInput,
  SlackError,
  type SlackThreadContext,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DiscordApi from "../discord/DiscordApi.ts";
import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
import * as LinearApi from "../linear/LinearApi.ts";
import * as GranolaApi from "../granola/GranolaApi.ts";
import * as NotionApi from "../notion/NotionApi.ts";
import * as GoogleApi from "../google/GoogleApi.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackApi from "../slack/SlackApi.ts";
import * as McpContextLinks from "./McpContextLinks.ts";

const LINEAR_URL = "https://linear.app/acme/issue/ENG-12/fix-the-thing";
const SLACK_URL = "https://acme.slack.com/archives/C0123ABCD/p1700000000123456";
const GOOGLE_URL = "https://docs.google.com/spreadsheets/d/sheet_1/edit#gid=42&range=B4:D6";
const NOTION_URL = "https://www.notion.so/acme/Plan-0123456789abcdef0123456789abcdef";

const linearIssue = {
  id: "8a6f4f0e-0000-4000-8000-000000000001",
  identifier: "ENG-12",
  title: "Fix the thing",
  url: LINEAR_URL,
  stateName: "Todo",
  markdown: "The thing is broken.",
} as LinearIssueContext;

const slackThread = (input: SlackGetThreadInput): SlackThreadContext => ({
  teamId: "T1",
  channelId: input.channelId,
  channelLabel: "#eng",
  ts: input.ts,
  threadTs: null,
  url: input.url,
  authorName: "Sam",
  title: "Deploy is stuck",
  replyCount: 2,
  scope: input.scope,
  markdown: "Deploy is stuck\n\n> on it",
  messages: [],
});

const GRANOLA_ID = "abd3f11c-e46a-4467-bfff-9a06519ef066";
const GRANOLA_URL = `https://notes.granola.ai/d/${GRANOLA_ID}`;

let slackRequests: Array<SlackGetThreadInput> = [];

const DISCORD_URL =
  "https://discord.com/channels/100000000000000001/100000000000000002/100000000000000003";

const discordThread = (input: DiscordGetThreadInput): DiscordThreadContext => ({
  guildId: input.guildId,
  channelId: input.channelId,
  channelLabel: "#eng",
  messageId: input.messageId,
  threadId: null,
  url: input.url,
  authorName: "Sam",
  title: "Deploy is stuck",
  replyCount: 0,
  scope: input.scope,
  markdown: "Deploy is stuck",
  messages: [],
});

let discordRequests: Array<DiscordGetThreadInput> = [];

const LINEAR_PROJECT_URL =
  "https://linear.app/acme/project/structured-discussion-guide-bc857ff37b9f/issues?layout=list";
let linearObjectRequests: Array<LinearGetObjectInput> = [];

const layer = (settings: Parameters<typeof ServerSettings.layerTest>[0] = {}) =>
  McpContextLinks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LinearApi.LinearApi, {
          getIssue: () => Effect.succeed(linearIssue),
          getObject: (input) => {
            linearObjectRequests.push(input);
            return Effect.succeed({
              objectType: input.objectType,
              id: "8a6f4f0e-0000-4000-8000-000000000002",
              title: "Structured discussion guide",
              url: LINEAR_PROJECT_URL,
              status: "In Progress",
              markdown: "# Project: Structured discussion guide",
            });
          },
        }),
        Layer.mock(SlackApi.SlackApi, {
          getThread: (input) => {
            slackRequests.push(input);
            return Effect.succeed(slackThread(input));
          },
        }),
        Layer.mock(DiscordApi.DiscordApi, {
          getThread: (input) => {
            discordRequests.push(input);
            return Effect.succeed(discordThread(input));
          },
        }),
        Layer.mock(NotionApi.NotionApi, {
          getPage: () =>
            Effect.fail(new NotionError({ reason: "not-found", detail: "Page not found." })),
        }),
        Layer.mock(GoogleApi.GoogleApi, {
          getFile: ({ id }) =>
            id === GOOGLE_URL
              ? Effect.succeed({
                  id: "sheet_1",
                  title: "Budget",
                  fileType: "sheet",
                  url: id,
                  location: "Forecast!B4:D6",
                  grid: [["Budget", "20"]],
                  markdown: "| Budget | 20 |",
                  updatedAt: "2026-10-01T00:00:00.000Z",
                })
              : Effect.fail(
                  new GoogleError({ reason: "not-found", detail: "Document not found." }),
                ),
        }),
        Layer.mock(GranolaApi.GranolaApi, {
          getNote: (input) =>
            Effect.succeed({
              id: input.id,
              title: "Weekly sync",
              url: GRANOLA_URL,
              meetingAt: "2026-10-12T09:30:00.000+01:00",
              participants: ["Ada", "Grace"],
              creator: "Ada",
              markdown: "# Weekly sync\n\n## Summary\n\nShipped it.",
            }),
        }),
        Layer.mock(GitHubIssues.GitHubIssues, {}),
        ServerSettings.layerTest(settings),
      ),
    ),
  );

const attach = (text: string, links: ReadonlyArray<string> | undefined) =>
  McpContextLinks.McpContextLinks.pipe(
    Effect.flatMap((service) => service.attach({ text, links })),
  );

it.effect("reads a Linear project link by its slug id", () =>
  Effect.gen(function* () {
    linearObjectRequests = [];
    const result = yield* attach("Plan", [LINEAR_PROJECT_URL]);

    assert.deepStrictEqual(linearObjectRequests, [{ objectType: "project", id: "bc857ff37b9f" }]);
    assert.deepStrictEqual(
      result.context?.records.map((record) => [record.kind, record.label]),
      [["linear-object", "Structured discussion guide"]],
    );
  }).pipe(Effect.provide(layer())),
);

it.effect("turns links into the composer's chips, in place when the message mentions them", () =>
  Effect.gen(function* () {
    slackRequests = [];
    const result = yield* attach(`Fix ${LINEAR_URL}.`, [LINEAR_URL, SLACK_URL, LINEAR_URL]);

    assert.match(
      result.text,
      /^Fix \[ENG-12\]\(t3-context:\/\/v1\/linear-issue\/linear-issue_[^)]+\)\.\n\n\[/u,
    );
    assert.include(
      result.text,
      "(t3-context://v1/slack-thread/slack-thread_T1_C0123ABCD_1700000000-123456)",
    );
    assert.deepStrictEqual(
      result.context?.records.map((record) => record.kind),
      ["linear-issue", "slack-thread"],
    );
    // A permalink attaches its whole thread, as a pasted one does.
    assert.deepStrictEqual(
      slackRequests.map((request) => [request.ts, request.scope]),
      [["1700000000.123456", "thread"]],
    );
  }).pipe(Effect.provide(layer())),
);

it.effect("leaves a message without links as it is", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* attach("Just text", undefined), {
      text: "Just text",
      context: undefined,
    });
  }).pipe(Effect.provide(layer())),
);

it.effect("refuses an integration the user turned off", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(attach("", [SLACK_URL]));
    assert.strictEqual(error.code, "invalid_request");
    assert.include(error.message, "Slack integration is turned off");
  }).pipe(Effect.provide(layer({ enableSlackIntegration: false }))),
);

it.effect("attaches a Discord message link as its whole thread", () =>
  Effect.gen(function* () {
    discordRequests = [];
    const result = yield* attach(`See ${DISCORD_URL}`, [DISCORD_URL]);
    assert.deepStrictEqual(
      result.context?.records.map((record) => record.kind),
      ["discord-thread"],
    );
    assert.notInclude(result.text, DISCORD_URL);
    assert.deepStrictEqual(
      discordRequests.map((request) => [request.channelId, request.messageId, request.scope]),
      [["100000000000000002", "100000000000000003", "thread"]],
    );
  }).pipe(Effect.provide(layer())),
);

it.effect("refuses a Discord link while the integration is off", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(attach("", [DISCORD_URL]));
    assert.include(error.message, "Discord integration is turned off");
  }).pipe(Effect.provide(layer({ enableDiscordIntegration: false }))),
);

it.effect("says how to share a Notion page the connection cannot read", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(attach("", [NOTION_URL]));
    assert.include(error.message, "Connections");
  }).pipe(Effect.provide(layer())),
);

it.effect("attaches a Granola note as its chip", () =>
  Effect.gen(function* () {
    const result = yield* attach(`Notes: ${GRANOLA_URL}`, [GRANOLA_URL]);
    assert.strictEqual(
      result.text,
      `Notes: [Weekly sync](t3-context://v1/granola-note/granola-note_${GRANOLA_ID})`,
    );
    assert.deepStrictEqual(
      result.context?.records.map((record) => record.kind),
      ["granola-note"],
    );
  }).pipe(Effect.provide(layer())),
);

it.effect("refuses a Granola note while the integration is off", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(attach("", [GRANOLA_URL]));
    assert.include(error.message, "Granola integration is turned off");
  }).pipe(Effect.provide(layer({ enableGranolaIntegration: false }))),
);

it.effect("passes on why an integration could not read a link", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(attach("", [SLACK_URL]));
    assert.strictEqual(error.message, `Could not attach ${SLACK_URL}: Slack is not connected.`);
  }).pipe(
    Effect.provide(
      McpContextLinks.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(LinearApi.LinearApi, {}),
            Layer.mock(SlackApi.SlackApi, {
              getThread: () =>
                Effect.fail(
                  new SlackError({ reason: "not-connected", detail: "Slack is not connected." }),
                ),
            }),
            Layer.mock(DiscordApi.DiscordApi, {}),
            Layer.mock(NotionApi.NotionApi, {}),
            Layer.mock(GoogleApi.GoogleApi, {}),
            Layer.mock(GranolaApi.GranolaApi, {}),
            Layer.mock(GitHubIssues.GitHubIssues, {}),
            ServerSettings.layerTest(),
          ),
        ),
      ),
    ),
  ),
);

it.effect("rejects links it cannot attach", () =>
  Effect.gen(function* () {
    const ordinary = yield* Effect.flip(attach("", ["https://example.com/page"]));
    assert.include(ordinary.message, "is not a link T3 Code can attach");
    const pullRequest = yield* Effect.flip(attach("", ["https://github.com/acme/app/pull/7"]));
    assert.include(pullRequest.message, "Pull request links cannot be attached");
  }).pipe(Effect.provide(layer())),
);

const read = (url: string) =>
  McpContextLinks.McpContextLinks.pipe(Effect.flatMap((service) => service.read(url)));

it.effect("reads a link into its chip record without a message", () =>
  Effect.gen(function* () {
    slackRequests = [];
    const record = yield* read(SLACK_URL);
    assert.strictEqual(record.kind, "slack-thread");
    assert.deepStrictEqual(
      slackRequests.map((request) => request.scope),
      ["thread"],
    );
    const notion = yield* Effect.flip(read(NOTION_URL));
    assert.match(notion.message, /^Could not read /u);
  }).pipe(Effect.provide(layer())),
);

it.effect("refuses to read repositories, pull requests, and unknown links", () =>
  Effect.gen(function* () {
    const repository = yield* Effect.flip(read("https://github.com/acme/app"));
    assert.include(repository.message, "cloned rather than read");
    const pullRequest = yield* Effect.flip(read("https://github.com/acme/app/pull/7"));
    assert.include(pullRequest.message, "cannot be read here");
    const ordinary = yield* Effect.flip(read("https://example.com/page"));
    assert.include(ordinary.message, "is not a link T3 Code can read");
  }).pipe(Effect.provide(layer())),
);

it.effect("reads and attaches a Google citation at its native range", () =>
  Effect.gen(function* () {
    const record = yield* read(GOOGLE_URL);
    assert.strictEqual(record.kind, "google-file");
    if (record.kind === "google-file") {
      assert.strictEqual(record.location, "Forecast!B4:D6");
      assert.deepEqual(record.grid, [["Budget", "20"]]);
    }
    const result = yield* attach(`Use [Budget](${GOOGLE_URL})`, [GOOGLE_URL]);
    assert.strictEqual(result.context?.records[0]?.kind, "google-file");
    assert.notInclude(result.text, GOOGLE_URL);
  }).pipe(Effect.provide(layer())),
);
it.effect("honors the environment's Google off switch for agents", () =>
  Effect.gen(function* () {
    const error = yield* read(GOOGLE_URL).pipe(Effect.flip);
    assert.include(error.message, "turned off");
  }).pipe(Effect.provide(layer({ enableGoogleIntegration: false }))),
);
