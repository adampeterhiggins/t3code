import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  DiscordError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Settings from "../serverSettings.ts";
import * as DiscordApi from "./DiscordApi.ts";
import * as DiscordAuth from "./DiscordAuth.ts";
import * as Trigger from "./DiscordMentionTrigger.ts";
import { millisToSnowflake } from "./discordMarkdown.ts";

const BOT = "900000000000000001";
const USER = "900000000000000002";
const account = { botUserId: BOT, botName: "T3 Code", applicationId: BOT };
const projectId = ProjectId.make("project-discord");
const configuredModel = { instanceId: ProviderInstanceId.make("claudeCode"), model: "test-model" };

const mention = (
  atMs: number,
  content = `<@${BOT}> help fix deploy`,
  extra: Partial<DiscordApi.DiscordMention> = {},
): DiscordApi.DiscordMention => {
  const messageId = (BigInt(millisToSnowflake(atMs)) + 1n).toString();
  return {
    guildId: "100000000000000001",
    channelId: "100000000000000002",
    channelName: "eng",
    parentId: null,
    parentName: null,
    messageId,
    authorId: "900000000000000099",
    content,
    url: `https://discord.com/channels/100000000000000001/100000000000000002/${messageId}`,
    ...extra,
  };
};

const harness = Effect.gen(function* () {
  // Discord ids cannot name a time before 2015.
  yield* TestClock.setTime(Date.parse("2026-10-01T00:00:00Z"));
  const now = yield* Clock.currentTimeMillis;
  let settings = {
    ...DEFAULT_SERVER_SETTINGS,
    discordMentionTrigger: {
      ...DEFAULT_SERVER_SETTINGS.discordMentionTrigger,
      enabled: true,
      projectId,
      channels: ["eng"],
      keyword: "fix",
      prompt: "Investigate and suggest a fix.",
      modelSelection: configuredModel,
    },
  };
  let mentions = [mention(now - 1000), mention(now + 1000)];
  const searchedFor: Array<string> = [];
  let failRead = false;
  const launches: ThreadLaunch.ThreadLaunchInput[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(Settings.ServerSettingsService)({ getSettings: Effect.sync(() => settings) }),
    Layer.mock(DiscordAuth.DiscordAuth)({ account: Effect.succeed(account) }),
    Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeed(Option.none()) }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          launches.push(input);
          // The trigger only awaits acceptance; no projection fields are read.
          return {
            threadId: ThreadId.make("unused"),
            projection: {} as OrchestrationV2ThreadProjection,
            resumed: false,
          };
        }),
    }),
    Layer.mock(DiscordApi.DiscordApi)({
      searchMentions: (input) =>
        Effect.sync(() => {
          searchedFor.push(input.userId);
          return mentions;
        }),
      getThread: (input) =>
        failRead
          ? Effect.fail(new DiscordError({ detail: "Rate limited", reason: "rate-limited" }))
          : Effect.succeed({
              ...input,
              threadId: null,
              scope: "thread" as const,
              channelLabel: "#eng",
              authorName: "Grace",
              title: "help fix deploy",
              replyCount: 0,
              markdown: "Grace: help fix deploy",
              messages: [],
            }),
    }),
  );
  return {
    create: Trigger.make.pipe(Effect.provide(dependencies)),
    launches,
    searchedFor,
    setSettings: (patch: Partial<typeof settings.discordMentionTrigger>) => {
      settings = {
        ...settings,
        discordMentionTrigger: { ...settings.discordMentionTrigger, ...patch },
      };
    },
    setMentions: (value: DiscordApi.DiscordMention[]) => {
      mentions = value;
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
  };
});

it.effect(
  "baselines on enable, then launches new matching mentions once, even after recreation",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const trigger = yield* h.create;
      yield* trigger.pollOnce;
      assert.strictEqual(h.searchedFor.length, 0);
      yield* trigger.pollOnce;
      assert.deepStrictEqual(h.searchedFor, [BOT]);
      assert.strictEqual(h.launches.length, 1);
      assert.deepStrictEqual(h.launches[0]?.modelSelection, configuredModel);
      assert.ok(h.launches[0]?.initialMessage?.text.startsWith("Investigate and suggest a fix."));
      assert.strictEqual(
        h.launches[0]?.initialMessage?.context?.records[0]?.kind,
        "discord-thread",
      );
      yield* (yield* h.create).pollOnce;
      assert.strictEqual(h.launches.length, 1);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it.effect("leaves a failed read to retry with the same command id", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const trigger = yield* h.create;
    yield* trigger.pollOnce;
    h.failRead(true);
    yield* trigger.pollOnce;
    assert.strictEqual(h.launches.length, 0);
    h.failRead(false);
    yield* trigger.pollOnce;
    assert.strictEqual(h.launches.length, 1);
    assert.match(String(h.launches[0]?.commandId), /^discord-mention:\d+$/);
  }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it.effect("watches a chosen user instead of the bot, starting a fresh baseline", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const trigger = yield* h.create;
    yield* trigger.pollOnce;
    h.setSettings({ mentionUserId: USER });
    yield* trigger.pollOnce;
    assert.strictEqual(h.searchedFor.length, 0);
    const now = yield* Clock.currentTimeMillis;
    h.setMentions([mention(now + 2000, `<@!${USER}> please fix this`)]);
    yield* trigger.pollOnce;
    assert.deepStrictEqual(h.searchedFor, [USER]);
    assert.strictEqual(h.launches.length, 1);
  }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it("matches every channel when none are listed, and threads under a listed channel", () => {
  const config = { ...DEFAULT_SERVER_SETTINGS.discordMentionTrigger, keyword: "" };
  const inThread = mention(0, "hi", {
    channelId: "100000000000000005",
    channelName: "Deploy",
    parentId: "100000000000000002",
    parentName: "eng",
  });
  assert.isTrue(Trigger.mentionMatches(config, mention(0)));
  assert.isTrue(Trigger.mentionMatches({ ...config, channels: ["#ENG"] }, inThread));
  assert.isTrue(Trigger.mentionMatches({ ...config, channels: ["100000000000000002"] }, inThread));
  assert.isFalse(Trigger.mentionMatches({ ...config, channels: ["random"] }, inThread));
  assert.isFalse(Trigger.mentionMatches({ ...config, keyword: "fix" }, mention(0, "prefix")));
});
