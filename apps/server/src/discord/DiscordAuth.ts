import {
  DiscordAccount,
  type DiscordConnectInput,
  type DiscordConnectionState,
  DiscordError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { discordApiRequest } from "./discordRestApi.ts";

const DISCORD_TOKEN_SECRET = "discord-bot-token";
const REVOKED = "Discord rejected the bot token. Paste a new one to reconnect.";

const PersistedDiscordToken = Schema.Struct({
  botToken: Schema.String,
  account: DiscordAccount,
});
type PersistedDiscordToken = typeof PersistedDiscordToken.Type;
const PersistedDiscordTokenJson = Schema.fromJsonString(PersistedDiscordToken);
const decodePersistedToken = Schema.decodeUnknownEffect(PersistedDiscordTokenJson);
const encodePersistedToken = Schema.encodeEffect(PersistedDiscordTokenJson);

const CurrentUser = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  global_name: Schema.optional(Schema.NullOr(Schema.String)),
  bot: Schema.optional(Schema.Boolean),
});
const CurrentApplication = Schema.Struct({ id: Schema.String });

const disconnectedState: DiscordConnectionState = {
  phase: "disconnected",
  account: null,
  message: null,
};
const connectedState = (account: DiscordAccount): DiscordConnectionState => ({
  phase: "connected",
  account,
  message: null,
});
const failedState = (message: string): DiscordConnectionState => ({
  phase: "failed",
  account: null,
  message,
});

const loginError = (detail: string, cause?: unknown) =>
  new DiscordError({ reason: "login", detail, ...(cause === undefined ? {} : { cause }) });

export class DiscordAuth extends Context.Service<
  DiscordAuth,
  {
    readonly state: Stream.Stream<DiscordConnectionState>;
    /** Checks the token with Discord, then keeps it for every client of this environment. */
    readonly connect: (
      input: DiscordConnectInput,
    ) => Effect.Effect<DiscordConnectionState, DiscordError>;
    readonly disconnect: Effect.Effect<DiscordConnectionState, DiscordError>;
    readonly botToken: Effect.Effect<string, DiscordError>;
    readonly account: Effect.Effect<DiscordAccount, DiscordError>;
    /** Drops the stored token after Discord rejects it. */
    readonly markRevoked: Effect.Effect<void>;
  }
>()("t3/discord/DiscordAuth") {}

/** @public */
export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);
  const lock = yield* Semaphore.make(1);

  const readToken = secrets
    .get(DISCORD_TOKEN_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isNone(bytes)
          ? Effect.succeedNone
          : decodePersistedToken(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
      ),
    );
  const removeToken = secrets.remove(DISCORD_TOKEN_SECRET).pipe(Effect.ignore);

  const initial = yield* readToken.pipe(
    Effect.map((token) =>
      Option.isSome(token) ? connectedState(token.value.account) : disconnectedState,
    ),
    Effect.orElseSucceed(() => disconnectedState),
  );
  const state = yield* SubscriptionRef.make<DiscordConnectionState>(initial);

  const readAccount = Effect.fn("discord.auth.read_account")(function* (botToken: string) {
    const [user, application] = yield* Effect.all(
      [
        discordApiRequest(botToken, "/users/@me", [], CurrentUser),
        discordApiRequest(botToken, "/oauth2/applications/@me", [], CurrentApplication),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.provide(services),
      Effect.mapError((error) =>
        error.reason === "revoked"
          ? loginError("Discord rejected that token. Copy the bot token from the Bot page again.")
          : error,
      ),
    );
    if (user.bot !== true) {
      return yield* loginError(
        "That is not a bot token. Copy it from your application's Bot page.",
      );
    }
    return {
      botUserId: user.id,
      botName: user.global_name ?? user.username,
      applicationId: application.id,
    } satisfies DiscordAccount;
  });

  const connect = Effect.fn("discord.auth.connect")(function* (input: DiscordConnectInput) {
    const botToken = input.botToken.replace(/^Bot\s+/i, "");
    const account = yield* readAccount(botToken);
    yield* encodePersistedToken({ botToken, account }).pipe(
      Effect.flatMap((encoded) =>
        secrets.set(DISCORD_TOKEN_SECRET, new TextEncoder().encode(encoded)),
      ),
      Effect.mapError((cause) => loginError("Could not save the Discord bot token.", cause)),
    );
    const connected = connectedState(account);
    yield* SubscriptionRef.set(state, connected);
    return connected;
  }, lock.withPermits(1));

  const disconnect = lock
    .withPermits(1)(
      Effect.gen(function* () {
        yield* removeToken;
        yield* SubscriptionRef.set(state, disconnectedState);
        return disconnectedState;
      }),
    )
    .pipe(Effect.withSpan("discord.auth.disconnect"));

  const markRevoked = lock.withPermits(1)(
    Effect.gen(function* () {
      yield* removeToken;
      yield* SubscriptionRef.set(state, failedState(REVOKED));
    }),
  );

  const storedToken: Effect.Effect<PersistedDiscordToken, DiscordError> = readToken.pipe(
    Effect.mapError(
      (cause) =>
        new DiscordError({ reason: "api", detail: "Could not read the Discord bot token.", cause }),
    ),
    Effect.flatMap(
      Effect.fromOption(
        () =>
          new DiscordError({
            reason: "not-connected",
            detail: "Discord is not connected. Connect it in Settings → Integrations.",
          }),
      ),
    ),
  );

  return DiscordAuth.of({
    state: SubscriptionRef.changes(state),
    connect,
    disconnect,
    botToken: storedToken.pipe(Effect.map((token) => token.botToken)),
    account: storedToken.pipe(Effect.map((token) => token.account)),
    markRevoked,
  });
});

export const layer = Layer.effect(DiscordAuth, make);
