import {
  type GoogleThreadLink,
  type OrchestrationV2ThreadShell,
  type SlackThreadContext,
  type SlackThreadLink,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DiscordApi from "../discord/DiscordApi.ts";
import * as DiscordThreadLinks from "../discord/DiscordThreadLinks.ts";
import * as GitHubIssueThreadLinks from "../githubIssues/GitHubIssueThreadLinks.ts";
import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
import * as GranolaApi from "../granola/GranolaApi.ts";
import * as GranolaThreadLinks from "../granola/GranolaThreadLinks.ts";
import * as LinearApi from "../linear/LinearApi.ts";
import * as LinearThreadLinks from "../linear/LinearThreadLinks.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as NotionApi from "../notion/NotionApi.ts";
import * as GoogleApi from "../google/GoogleApi.ts";
import * as NotionThreadLinks from "../notion/NotionThreadLinks.ts";
import * as GoogleThreadLinks from "../google/GoogleThreadLinks.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackApi from "../slack/SlackApi.ts";
import * as SlackThreadLinks from "../slack/SlackThreadLinks.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { ensureThreadLinkWatchesSchema } from "./threadLinkWatchSchema.ts";
import * as ThreadLinkWatches from "./ThreadLinkWatches.ts";

const THREAD_ID = ThreadId.make("thread-1");

const slackLink = (threadTs: string): SlackThreadLink => ({
  groupId: THREAD_ID,
  threadIds: [THREAD_ID],
  channelId: "C1",
  threadTs,
  channelLabel: "#eng",
  authorName: "Ada",
  title: "Review the plan",
  url: `https://acme.slack.com/archives/C1/p${threadTs.replace(".", "")}`,
  linkedAt: "2026-10-22T10:00:00.000Z",
});

const slackThread = (url: string, text: string): SlackThreadContext => ({
  teamId: "T1",
  channelId: "C1",
  channelLabel: "#eng",
  ts: "1.000100",
  threadTs: null,
  url,
  authorName: "Ada",
  title: "Review the plan",
  replyCount: 0,
  scope: "thread",
  markdown: text,
  messages: [
    {
      index: 0,
      authorName: "Ada",
      avatarUrl: null,
      postedAt: "2026-10-22T10:00:00.000Z",
      text,
      files: [],
      linked: true,
    },
  ],
});

const makeHarness = (settings: Parameters<typeof ServerSettings.layerTest>[0] = {}) => {
  const state = {
    link: slackLink("1.000100") as SlackThreadLink | undefined,
    text: "Review the plan",
    googleLink: undefined as GoogleThreadLink | undefined,
    shell: liveThreadShell(THREAD_ID, { activeRunId: null }) as OrchestrationV2ThreadShell | null,
  };
  const none = { forThread: () => Effect.succeed(undefined) };
  const layer = ThreadLinkWatches.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effectDiscard(
          Effect.gen(function* () {
            yield* runMigrations();
            yield* ensureThreadTabsSchema();
            yield* ensureThreadLinkWatchesSchema();
          }),
        ),
        ServerSettings.layerTest(settings),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: () => Effect.sync(() => state.shell),
        }),
        Layer.mock(SlackThreadLinks.SlackThreadLinks)({
          forThread: () => Effect.sync(() => state.link),
        }),
        Layer.mock(SlackApi.SlackApi)({
          getThread: (input) => Effect.sync(() => slackThread(input.url, state.text)),
        }),
        Layer.mock(LinearThreadLinks.LinearThreadLinks)(none),
        Layer.mock(GitHubIssueThreadLinks.GitHubIssueThreadLinks)(none),
        Layer.mock(DiscordThreadLinks.DiscordThreadLinks)(none),
        Layer.mock(NotionThreadLinks.NotionThreadLinks)(none),
        Layer.mock(GoogleThreadLinks.GoogleThreadLinks)({
          forThread: () => Effect.sync(() => state.googleLink),
        }),
        Layer.mock(GranolaThreadLinks.GranolaThreadLinks)(none),
        Layer.mock(LinearApi.LinearApi)({}),
        Layer.mock(GitHubIssues.GitHubIssues)({}),
        Layer.mock(DiscordApi.DiscordApi)({}),
        Layer.mock(NotionApi.NotionApi)({}),
        Layer.mock(GoogleApi.GoogleApi)({
          getFile: ({ id }) =>
            Effect.succeed({
              id: "doc-1",
              title: "Plan",
              fileType: "doc",
              url: id,
              updatedAt: "2026-10-22T10:00:00.000Z",
              markdown: state.text,
            }),
        }),
        Layer.mock(GranolaApi.GranolaApi)({}),
      ),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );
  return { state, layer };
};

describe("ThreadLinkWatches", () => {
  it.effect("starts from what the link shows now, and watching it again keeps the watch", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const watches = yield* ThreadLinkWatches.ThreadLinkWatches;
      const started = yield* watches.watch(THREAD_ID, "slack");
      expect(started).toMatchObject({ kind: "slack", url: slackLink("1.000100").url, wakes: 0 });

      harness.state.text = "Review the plan, please";
      expect(yield* watches.watch(THREAD_ID, "slack")).toEqual(started);
      const [stored] = yield* watches.list;
      expect(stored?.baseline.messages).toHaveLength(1);

      // A save for a watch that has since restarted changes nothing.
      harness.state.link = slackLink("2.000200");
      const restarted = yield* watches.watch(THREAD_ID, "slack");
      expect(restarted.url).toBe(slackLink("2.000200").url);
      yield* watches.advance(stored!, { baseline: stored!.baseline, wakes: 5 });
      expect((yield* watches.forThread(THREAD_ID))[0]?.wakes).toBe(0);

      expect(yield* watches.unwatch(THREAD_ID, "slack")).toBe(true);
      expect(yield* watches.unwatch(THREAD_ID, "slack")).toBe(false);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("refuses a link that is missing or turned off, and an archived thread", () => {
    const harness = makeHarness({ enableSlackIntegration: false });
    return Effect.gen(function* () {
      const watches = yield* ThreadLinkWatches.ThreadLinkWatches;
      expect(yield* watches.watch(THREAD_ID, "slack").pipe(Effect.flip)).toMatchObject({
        reason: "unreadable",
        detail: expect.stringContaining("turned off"),
      });
      expect(yield* watches.watch(THREAD_ID, "notion").pipe(Effect.flip)).toMatchObject({
        reason: "not-linked",
      });
      harness.state.shell = {
        ...liveThreadShell(THREAD_ID, { activeRunId: null }),
        archivedAt: DateTime.makeUnsafe("2026-10-22T11:00:00.000Z"),
      };
      expect(yield* watches.watch(THREAD_ID, "linear").pipe(Effect.flip)).toMatchObject({
        reason: "thread-unavailable",
      });
      expect(yield* watches.list).toEqual([]);
    }).pipe(Effect.provide(harness.layer));
  });
});

it.effect("watches Google content and comments at the linked source location", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    h.state.googleLink = {
      groupId: THREAD_ID,
      threadIds: [THREAD_ID],
      fileId: "doc-1",
      fileType: "doc",
      title: "Plan",
      url: "https://docs.google.com/document/d/doc-1/edit#heading=h.price",
      linkedAt: "2026-10-22T10:00:00.000Z",
    };
    const watches = yield* ThreadLinkWatches.ThreadLinkWatches;
    const watch = yield* watches.watch(THREAD_ID, "google");
    expect(watch.url).toBe(h.state.googleLink.url);
    const [baseline] = yield* watches.list;
    h.state.text += "\n\n## Comments\nPriya: Please revise pricing";
    const read = yield* watches.readLink(THREAD_ID, "google");
    expect(read._tag).toBe("read");
    if (read._tag === "read") expect(read.snapshot.bodyHash).not.toBe(baseline!.baseline.bodyHash);
    expect(yield* watches.unwatch(THREAD_ID, "google")).toBe(true);
  }).pipe(Effect.provide(h.layer));
});
