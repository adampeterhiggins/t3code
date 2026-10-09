import { assert, it } from "@effect/vitest";
import {
  type LinearIssueContext,
  NotionError,
  type SlackGetThreadInput,
  SlackError,
  type SlackThreadContext,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
import * as LinearApi from "../linear/LinearApi.ts";
import * as NotionApi from "../notion/NotionApi.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackApi from "../slack/SlackApi.ts";
import * as McpContextLinks from "./McpContextLinks.ts";

const LINEAR_URL = "https://linear.app/acme/issue/ENG-12/fix-the-thing";
const SLACK_URL = "https://acme.slack.com/archives/C0123ABCD/p1700000000123456";
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
});

let slackRequests: Array<SlackGetThreadInput> = [];

const layer = (settings: Parameters<typeof ServerSettings.layerTest>[0] = {}) =>
  McpContextLinks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LinearApi.LinearApi, {
          getIssue: () => Effect.succeed(linearIssue),
        }),
        Layer.mock(SlackApi.SlackApi, {
          getThread: (input) => {
            slackRequests.push(input);
            return Effect.succeed(slackThread(input));
          },
        }),
        Layer.mock(NotionApi.NotionApi, {
          getPage: () =>
            Effect.fail(new NotionError({ reason: "not-found", detail: "Page not found." })),
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

it.effect("says how to share a Notion page the connection cannot read", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(attach("", [NOTION_URL]));
    assert.include(error.message, "Connections");
  }).pipe(Effect.provide(layer())),
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
            Layer.mock(NotionApi.NotionApi, {}),
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
