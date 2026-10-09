import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  SlackError,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Settings from "../serverSettings.ts";
import * as SlackApi from "./SlackApi.ts";
import * as SlackAuth from "./SlackAuth.ts";
import * as Trigger from "./SlackMentionTrigger.ts";

const account = {
  teamId: "T1",
  userId: "U1",
  userName: "Ada",
  teamName: "Acme",
  teamUrl: "https://acme.slack.com",
};
const projectId = ProjectId.make("project-slack");
const configuredModel = { instanceId: ProviderInstanceId.make("claudeCode"), model: "test-model" };
const mention = (ts: string, text = "<@U1> help fix deploy"): SlackApi.SlackMention => ({
  channelId: "C1",
  channelName: "eng",
  ts,
  threadTs: null,
  userId: "U2",
  text,
  url: `https://acme.slack.com/archives/C1/p${ts.replace(".", "")}`,
});
const harness = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  let settings = {
    ...DEFAULT_SERVER_SETTINGS,
    slackMentionTrigger: {
      ...DEFAULT_SERVER_SETTINGS.slackMentionTrigger,
      enabled: true,
      projectId,
      channels: ["eng"],
      keyword: "fix",
      prompt: "Investigate and suggest a fix.",
      modelSelection: configuredModel,
    },
  };
  let mentions = [mention(String((now - 1000) / 1000)), mention(String((now + 1000) / 1000))];
  let currentAccount = account;
  let searches = 0;
  let failRead = false;
  let failLaunch = false;
  const launches: ThreadLaunch.ThreadLaunchInput[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(Settings.ServerSettingsService)({ getSettings: Effect.sync(() => settings) }),
    Layer.mock(SlackAuth.SlackAuth)({ account: Effect.sync(() => currentAccount) }),
    Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeed(Option.none()) }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.gen(function* () {
          launches.push(input);
          if (failLaunch)
            return yield* new ThreadLaunch.ThreadLaunchError({
              commandId: input.commandId,
              projectId: input.projectId,
              operation: "dispatch-message",
              cause: new Error("test failure"),
            });
          // The trigger only awaits acceptance; no projection fields are read.
          return {
            threadId: ThreadId.make("unused"),
            projection: {} as OrchestrationV2ThreadProjection,
            resumed: false,
          };
        }),
    }),
    Layer.mock(SlackApi.SlackApi)({
      searchMentions: () =>
        Effect.sync(() => {
          searches++;
          return mentions;
        }),
      getThread: (input) =>
        failRead
          ? Effect.fail(new SlackError({ detail: "Rate limited", reason: "rate-limited" }))
          : Effect.succeed({
              ...input,
              teamId: account.teamId,
              scope: "thread" as const,
              threadTs: null,
              channelLabel: "#eng",
              authorName: "Grace",
              title: "fix deploy",
              replyCount: 0,
              markdown: "Grace: <@U1> help fix deploy",
            }),
    }),
  );
  const create = Trigger.make.pipe(Effect.provide(dependencies));
  return {
    create,
    launches,
    get searches() {
      return searches;
    },
    setSettings: (patch: Partial<typeof settings.slackMentionTrigger>) => {
      settings = {
        ...settings,
        slackMentionTrigger: { ...settings.slackMentionTrigger, ...patch },
      };
    },
    setMentions: (value: SlackApi.SlackMention[]) => {
      mentions = value;
    },
    setAccount: () => {
      currentAccount = { ...account, userId: "U3" };
    },
    failLaunch: (value: boolean) => {
      failLaunch = value;
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
  };
});

it.effect(
  "baselines enable, launches new matching mentions with configured prompt/model and persists dedupe across recreation",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const trigger = yield* h.create;
      yield* trigger.pollOnce;
      assert.strictEqual(h.searches, 0);
      yield* trigger.pollOnce;
      assert.strictEqual(h.launches.length, 1);
      assert.deepStrictEqual(h.launches[0]?.modelSelection, configuredModel);
      assert.strictEqual(h.launches[0]?.projectId, projectId);
      assert.ok(h.launches[0]?.initialMessage?.text.startsWith("Investigate and suggest a fix."));
      assert.strictEqual(h.launches[0]?.initialMessage?.context?.records[0]?.kind, "slack-thread");
      yield* (yield* h.create).pollOnce;
      assert.strictEqual(h.launches.length, 1);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it.effect(
  "leaves failed reads retryable and does not replay filtered mentions when settings change",
  () =>
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
      const now = yield* Clock.currentTimeMillis;
      h.setMentions([mention(String((now + 2000) / 1000), "<@U1> say hello")]);
      yield* trigger.pollOnce;
      h.setSettings({ keyword: "" });
      yield* trigger.pollOnce;
      assert.strictEqual(h.launches.length, 1);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it.effect("disable and account changes baseline historical mentions again", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const trigger = yield* h.create;
    yield* trigger.pollOnce;
    h.setSettings({ enabled: false });
    yield* trigger.pollOnce;
    h.setSettings({ enabled: true });
    h.setMentions([]);
    yield* trigger.pollOnce;
    assert.strictEqual(h.searches, 0);
    h.setAccount();
    yield* trigger.pollOnce;
    assert.strictEqual(h.searches, 0);
    assert.strictEqual(h.launches.length, 0);
  }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it.effect("disabled polling only removes durable state when it exists", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const backing = yield* KeyValueStore.KeyValueStore;
    let removals = 0;
    const trigger = yield* h.create.pipe(
      Effect.provideService(KeyValueStore.KeyValueStore, {
        ...backing,
        remove: (key) => {
          removals++;
          return backing.remove(key);
        },
      }),
    );
    h.setSettings({ enabled: false });
    yield* trigger.pollOnce;
    yield* trigger.pollOnce;
    assert.strictEqual(removals, 0);
    h.setSettings({ enabled: true });
    yield* trigger.pollOnce;
    h.setSettings({ enabled: false });
    yield* trigger.pollOnce;
    yield* trigger.pollOnce;
    assert.strictEqual(removals, 1);
    assert.strictEqual(h.searches, 0);
    assert.strictEqual(h.launches.length, 0);
  }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it("matches explicit channel scope, optional DMs and literal whole-word keywords", () => {
  const config = {
    ...DEFAULT_SERVER_SETTINGS.slackMentionTrigger,
    channels: ["#ENG"],
    keyword: "fix",
  };
  assert.isTrue(Trigger.mentionMatches(config, mention("1")));
  assert.isFalse(Trigger.mentionMatches(config, mention("1", "prefix")));
  assert.isFalse(Trigger.mentionMatches(config, { ...mention("1"), channelName: null }));
  assert.isTrue(
    Trigger.mentionMatches(
      { ...config, includeDirectMessages: true },
      { ...mention("1"), channelName: null },
    ),
  );
  assert.isTrue(
    Trigger.mentionMatches({ ...config, keyword: "a+b" }, mention("1", "please a+b now")),
  );
});

it.effect(
  "retries a failed launch with the same durable command and message ids after recreation",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const trigger = yield* h.create;
      yield* trigger.pollOnce;
      h.failLaunch(true);
      yield* trigger.pollOnce;
      h.failLaunch(false);
      yield* (yield* h.create).pollOnce;
      assert.strictEqual(h.launches.length, 2);
      assert.strictEqual(h.launches[0]?.commandId, h.launches[1]?.commandId);
      assert.strictEqual(
        h.launches[0]?.initialMessage?.messageId,
        h.launches[1]?.initialMessage?.messageId,
      );
      yield* trigger.pollOnce;
      assert.strictEqual(h.launches.length, 2);
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);
