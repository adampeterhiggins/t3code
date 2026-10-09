import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type ModelSelection,
  type ProjectId,
  ProviderInstanceId,
  type ServerSettings,
  type SlackMentionTriggerSettings,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { slackThreadContextRecord } from "@t3tools/shared/integrationContextRecords";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import * as ServerConfig from "../config.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as SlackApi from "./SlackApi.ts";
import * as SlackAuth from "./SlackAuth.ts";

/** Slack search is rate-limited to about 20 calls a minute; one a minute leaves room for the user. */
const POLL_INTERVAL = "1 minute";
/** Keep a bounded recent history; advance the timestamp floor as old entries leave it. */
const SEEN_MAX = 500;
const TITLE_MAX_CHARS = 80;
const STATE_KEY = "state";
/** What a launch uses when neither the project nor the environment names a default model. */
const FALLBACK_MODEL: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
};

/**
 * What the trigger remembers for the connected account: when it was turned on, so older mentions
 * are ignored, and which mentions it has already judged.
 */
const TriggerState = Schema.Struct({
  account: Schema.String,
  enabledAtMs: Schema.Number,
  seen: Schema.Array(Schema.String),
});
type TriggerState = typeof TriggerState.Type;

const isActive = (settings: ServerSettings) =>
  settings.enableSlackIntegration &&
  settings.slackMentionTrigger.enabled &&
  settings.slackMentionTrigger.projectId !== null;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the trigger's channel and keyword filters let a mention through. */
export function mentionMatches(
  trigger: SlackMentionTriggerSettings,
  mention: SlackApi.SlackMention,
) {
  const inScope =
    mention.channelName === null
      ? trigger.includeDirectMessages
      : trigger.channels.some((entry) => {
          const wanted = entry.replace(/^#/, "").toLowerCase();
          return (
            wanted === mention.channelName?.toLowerCase() ||
            wanted === mention.channelId.toLowerCase()
          );
        });
  if (!inScope) return false;
  if (trigger.keyword.length === 0) return true;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(trigger.keyword)}(?![\\p{L}\\p{N}_])`,
    "iu",
  ).test(mention.text);
}

const tsMillis = (ts: string) => Number.parseFloat(ts) * 1_000;

export class SlackMentionTrigger extends Context.Service<
  SlackMentionTrigger,
  {
    /** Polls once a minute, and at once when the trigger is turned on or off. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** One pass: reads new mentions and starts a thread for each that matches. */
    readonly pollOnce: Effect.Effect<void>;
  }
>()("t3/slack/SlackMentionTrigger") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const auth = yield* SlackAuth.SlackAuth;
  const slack = yield* SlackApi.SlackApi;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, TriggerState);
  const lock = yield* Semaphore.make(1);

  const saveState = (state: TriggerState) => store.set(STATE_KEY, state);

  const startThread = Effect.fn("slack.mention_trigger.start_thread")(function* (
    settings: ServerSettings,
    projectId: ProjectId,
    teamId: string,
    mention: SlackApi.SlackMention,
  ) {
    const thread = yield* slack.getThread({
      channelId: mention.channelId,
      ts: mention.ts,
      ...(mention.threadTs === null ? {} : { threadTs: mention.threadTs }),
      url: mention.url,
      scope: "thread",
    });
    const record = slackThreadContextRecord(thread);
    const project = yield* projects.getById(projectId);
    const resolved = resolveProjectSettings(
      settings,
      projectId,
      Option.getOrNull(project),
    ).settings;
    // The same mention always maps to the same command, so a replay never starts a second thread.
    const key = `${teamId}:${mention.channelId}:${mention.ts}`;
    yield* threadLaunch.launch({
      commandId: CommandId.make(`slack-mention:${key}`),
      projectId,
      title: `Slack: ${thread.title}`.slice(0, TITLE_MAX_CHARS),
      modelSelection:
        settings.slackMentionTrigger.modelSelection ??
        resolved.defaultModelSelection ??
        FALLBACK_MODEL,
      runtimeMode: resolved.defaultRuntimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      workspaceStrategy: { type: "root" },
      initialMessage: {
        messageId: MessageId.make(`slack-mention-message:${key}`),
        text: `${settings.slackMentionTrigger.prompt}\n\n${formatComposerContextReference(record)}`,
        attachments: [],
        context: { version: 1, records: [record] },
      },
      createdBy: "system",
      creationSource: "server",
    });
  });

  const poll = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const projectId = settings.slackMentionTrigger.projectId;
    if (!isActive(settings) || projectId === null) {
      // Turning the trigger back on starts from that moment.
      yield* store.remove(STATE_KEY);
      return;
    }
    const account = yield* auth.account;
    const accountKey = `${account.teamId}:${account.userId}`;
    const stored = yield* store.get(STATE_KEY);
    if (Option.isNone(stored) || stored.value.account !== accountKey) {
      yield* saveState({
        account: accountKey,
        enabledAtMs: yield* Clock.currentTimeMillis,
        seen: [],
      });
      return;
    }
    let state = stored.value;
    const seen = new Set(state.seen);
    const mentions = yield* slack.searchMentions({
      userId: account.userId,
      afterDay: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(state.enabledAtMs)),
    });
    const fresh = mentions
      .filter(
        (mention) =>
          tsMillis(mention.ts) > state.enabledAtMs &&
          !seen.has(`${mention.channelId}:${mention.ts}`),
      )
      .toSorted((a, b) => tsMillis(a.ts) - tsMillis(b.ts));
    for (const mention of fresh) {
      if (
        mention.userId !== account.userId &&
        mention.text.includes(`<@${account.userId}>`) &&
        mentionMatches(settings.slackMentionTrigger, mention)
      ) {
        const outcome = yield* startThread(settings, projectId, account.teamId, mention).pipe(
          Effect.as("done" as const),
          Effect.catch((error) =>
            Effect.logWarning("Slack mention launch will retry", {
              channelId: mention.channelId,
              ts: mention.ts,
              error,
            }).pipe(Effect.as("retry" as const)),
          ),
        );
        // A failed read or launch stays unseen. The durable command id makes retries safe.
        if (outcome === "retry") return;
      }
      // A mention is judged once, by the settings at the time, so editing the
      // channel list never replays older mentions.
      state = {
        account: state.account,
        enabledAtMs:
          state.seen.length >= SEEN_MAX
            ? Math.max(state.enabledAtMs, tsMillis(state.seen[0]?.split(":").at(-1) ?? "0"))
            : state.enabledAtMs,
        seen: [...state.seen, `${mention.channelId}:${mention.ts}`].slice(-SEEN_MAX),
      };
      yield* saveState(state);
      seen.add(`${mention.channelId}:${mention.ts}`);
    }
  });

  const pollOnce = lock.withPermits(1)(
    poll.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Slack mention poll failed", { cause }).pipe(Effect.asVoid),
      ),
      Effect.withSpan("slack.mention_trigger.poll"),
    ),
  );

  const start = Effect.gen(function* () {
    const changes = yield* settingsService.subscribeChanges;
    let active = isActive(yield* settingsService.getSettings.pipe(Effect.orDie));
    yield* forkParked(pollOnce.pipe(Effect.repeat(Schedule.spaced(POLL_INTERVAL)), Effect.asVoid));
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        const next = isActive(settings);
        if (next === active) return Effect.void;
        active = next;
        return next ? pollOnce : lock.withPermits(1)(store.remove(STATE_KEY).pipe(Effect.ignore));
      }),
    );
  });

  return SlackMentionTrigger.of({ start, pollOnce });
});

/** Without durable state the trigger stays inactive; the rest of the server can still start. */
const stateStoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return KeyValueStore.layerFileSystem(path.join(config.stateDir, "slack-mention-trigger"));
  }),
);

export const layer = Layer.effect(SlackMentionTrigger, make).pipe(
  Layer.provide(stateStoreLayer),
  Layer.catch(() => {
    const unavailable = Effect.logWarning(
      "Slack mention trigger disabled: durable state unavailable",
    );
    return Layer.succeed(SlackMentionTrigger, { start: unavailable, pollOnce: unavailable });
  }),
);

/** Builds the trigger and starts polling for the server's lifetime. */
export const layerStarted = Layer.effectDiscard(
  Effect.gen(function* () {
    const trigger = yield* SlackMentionTrigger;
    yield* trigger.start;
  }),
).pipe(Layer.provide(layer));
