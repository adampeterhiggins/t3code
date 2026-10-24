import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type DiscordMentionTriggerSettings,
  MessageId,
  type ModelSelection,
  type ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { discordThreadContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Clock from "effect/Clock";
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
import * as DiscordApi from "./DiscordApi.ts";
import * as DiscordAuth from "./DiscordAuth.ts";
import { snowflakeToMillis } from "./discordMarkdown.ts";

/** Each poll is one search per server the bot is in; once a minute leaves room for the user. */
const POLL_INTERVAL = "1 minute";
/** Keep a bounded recent history; advance the time floor as old entries leave it. */
const SEEN_MAX = 500;
const TITLE_MAX_CHARS = 80;
const STATE_KEY = "state";
/** What a launch uses when neither the project nor the environment names a default model. */
const FALLBACK_MODEL: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
};

/**
 * What the trigger remembers for the watched account: when it was turned on, so older mentions
 * are ignored, and which mentions (message ids) it has already judged.
 */
const TriggerState = Schema.Struct({
  account: Schema.String,
  enabledAtMs: Schema.Number,
  seen: Schema.Array(Schema.String),
});
type TriggerState = typeof TriggerState.Type;

const isActive = (settings: ServerSettings) =>
  settings.enableDiscordIntegration &&
  settings.discordMentionTrigger.enabled &&
  settings.discordMentionTrigger.projectId !== null;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the trigger's channel and keyword filters let a mention through. */
export function mentionMatches(
  trigger: DiscordMentionTriggerSettings,
  mention: DiscordApi.DiscordMention,
) {
  const names = new Set(
    [mention.channelId, mention.channelName, mention.parentId, mention.parentName]
      .filter((name) => name !== null)
      .map((name) => name.toLowerCase()),
  );
  const inScope =
    trigger.channels.length === 0 ||
    trigger.channels.some((entry) => names.has(entry.replace(/^#/, "").toLowerCase()));
  if (!inScope) return false;
  if (trigger.keyword.length === 0) return true;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(trigger.keyword)}(?![\\p{L}\\p{N}_])`,
    "iu",
  ).test(mention.content);
}

export class DiscordMentionTrigger extends Context.Service<
  DiscordMentionTrigger,
  {
    /** Polls once a minute, and at once when the trigger is turned on or off. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** One pass: reads new mentions and starts a thread for each that matches. */
    readonly pollOnce: Effect.Effect<void>;
  }
>()("t3/discord/DiscordMentionTrigger") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const auth = yield* DiscordAuth.DiscordAuth;
  const discord = yield* DiscordApi.DiscordApi;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, TriggerState);
  const lock = yield* Semaphore.make(1);

  const saveState = (state: TriggerState) => store.set(STATE_KEY, state);

  const startThread = Effect.fn("discord.mention_trigger.start_thread")(function* (
    settings: ServerSettings,
    projectId: ProjectId,
    mention: DiscordApi.DiscordMention,
  ) {
    const thread = yield* discord.getThread({
      guildId: mention.guildId,
      channelId: mention.channelId,
      messageId: mention.messageId,
      url: mention.url,
      scope: "thread",
    });
    const record = discordThreadContextRecord(thread);
    const project = yield* projects.getById(projectId);
    const resolved = resolveProjectSettings(
      settings,
      projectId,
      Option.getOrNull(project),
    ).settings;
    // The same mention always maps to the same command, so a replay never starts a second thread.
    const key = mention.messageId;
    yield* threadLaunch.launch({
      commandId: CommandId.make(`discord-mention:${key}`),
      projectId,
      title: `Discord: ${thread.title}`.slice(0, TITLE_MAX_CHARS),
      modelSelection:
        settings.discordMentionTrigger.modelSelection ??
        resolved.defaultModelSelection ??
        FALLBACK_MODEL,
      runtimeMode: resolved.defaultRuntimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      workspaceStrategy: { type: "root" },
      initialMessage: {
        messageId: MessageId.make(`discord-mention-message:${key}`),
        text: `${settings.discordMentionTrigger.prompt}\n\n${formatComposerContextReference(record)}`,
        attachments: [],
        context: { version: 1, records: [record] },
      },
      createdBy: "system",
      creationSource: "server",
    });
  });

  const poll = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const projectId = settings.discordMentionTrigger.projectId;
    if (!isActive(settings) || projectId === null) {
      // Turning the trigger back on starts from that moment.
      if (yield* store.has(STATE_KEY)) yield* store.remove(STATE_KEY);
      return;
    }
    const account = yield* auth.account;
    const watchedId = settings.discordMentionTrigger.mentionUserId || account.botUserId;
    const accountKey = `${account.botUserId}:${watchedId}`;
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
    const mentions = yield* discord.searchMentions({
      userId: watchedId,
      afterMs: state.enabledAtMs,
    });
    const fresh = mentions
      .filter(
        (mention) =>
          snowflakeToMillis(mention.messageId) > state.enabledAtMs && !seen.has(mention.messageId),
      )
      .toSorted((a, b) => snowflakeToMillis(a.messageId) - snowflakeToMillis(b.messageId));
    for (const mention of fresh) {
      if (
        mention.authorId !== watchedId &&
        new RegExp(`<@!?${escapeRegExp(watchedId)}>`).test(mention.content) &&
        mentionMatches(settings.discordMentionTrigger, mention)
      ) {
        const outcome = yield* startThread(settings, projectId, mention).pipe(
          Effect.as("done" as const),
          Effect.catch((error) =>
            Effect.logWarning("Discord mention launch will retry", {
              channelId: mention.channelId,
              messageId: mention.messageId,
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
          state.seen.length >= SEEN_MAX && state.seen[0] !== undefined
            ? Math.max(state.enabledAtMs, snowflakeToMillis(state.seen[0]))
            : state.enabledAtMs,
        seen: [...state.seen, mention.messageId].slice(-SEEN_MAX),
      };
      yield* saveState(state);
      seen.add(mention.messageId);
    }
  });

  const pollOnce = lock.withPermits(1)(
    poll.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Discord mention poll failed", { cause }).pipe(Effect.asVoid),
      ),
      Effect.withSpan("discord.mention_trigger.poll"),
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

  return DiscordMentionTrigger.of({ start, pollOnce });
});

/** Without durable state the trigger stays inactive; the rest of the server can still start. */
const stateStoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return KeyValueStore.layerFileSystem(path.join(config.stateDir, "discord-mention-trigger"));
  }),
);

export const layer = Layer.effect(DiscordMentionTrigger, make).pipe(
  Layer.provide(stateStoreLayer),
  Layer.catch(() => {
    const unavailable = Effect.logWarning(
      "Discord mention trigger disabled: durable state unavailable",
    );
    return Layer.succeed(DiscordMentionTrigger, { start: unavailable, pollOnce: unavailable });
  }),
);

/** Builds the trigger and starts polling for the server's lifetime. */
export const layerStarted = Layer.effectDiscard(
  Effect.gen(function* () {
    const trigger = yield* DiscordMentionTrigger;
    yield* trigger.start;
  }),
).pipe(Layer.provide(layer));
