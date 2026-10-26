import { DiscordError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const DISCORD_API_URL = "https://discord.com/api/v10";

/** Search answers 202 with no results while Discord builds a server's index. */
const DISCORD_INDEXING_DETAIL = "Discord is still indexing this server. Try again shortly.";

const ErrorBody = Schema.Struct({
  code: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
});
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

const apiError = (detail: string, cause?: unknown) =>
  new DiscordError({ reason: "api", detail, ...(cause === undefined ? {} : { cause }) });

export type DiscordQuery = ReadonlyArray<readonly [string, string]>;

/**
 * Calls one Discord REST endpoint as the bot. Discord reports failures through the HTTP status,
 * with a JSON `{ code, message }` body.
 */
export const discordApiRequest = Effect.fn("discord.rest_api")(function* <S extends Schema.Top>(
  botToken: string,
  path: string,
  query: DiscordQuery,
  data: S,
  method: "GET" | "DELETE" = "GET",
) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.make(method)(`${DISCORD_API_URL}${path}`).pipe(
    HttpClientRequest.setUrlParams(query),
    HttpClientRequest.setHeader("authorization", `Bot ${botToken}`),
    httpClient.execute,
    Effect.mapError((cause) => apiError("Could not reach Discord.", cause)),
  );
  if (response.status === 429) {
    return yield* new DiscordError({
      reason: "rate-limited",
      detail: "Discord's rate limit was reached. Try again in a minute.",
    });
  }
  if (response.status === 202) return yield* apiError(DISCORD_INDEXING_DETAIL);
  if (response.status === 401) {
    return yield* new DiscordError({
      reason: "revoked",
      detail: "Discord rejected the bot token. Reconnect Discord in Settings → Integrations.",
    });
  }
  if (response.status === 403 || response.status === 404) {
    return yield* new DiscordError({
      reason: "not-found",
      detail:
        "The T3 Code bot can't see that. Add it to the server and let it view the channel and read its history.",
    });
  }
  // A 204 has no body; callers expecting one decode `null` with `Schema.Null`.
  const json =
    response.status === 204
      ? null
      : yield* response.json.pipe(
          Effect.mapError((cause) =>
            apiError(`Discord returned an unreadable response (${response.status}).`, cause),
          ),
        );
  if (response.status < 200 || response.status >= 300) {
    const body = decodeErrorBody(json);
    const message = body._tag === "Some" ? body.value.message : undefined;
    return yield* apiError(
      message === undefined
        ? `Discord returned HTTP ${response.status}.`
        : `Discord returned an error (${message}).`,
    );
  }
  return yield* Schema.decodeEffect(data)(json).pipe(
    Effect.mapError((cause) => apiError("Discord returned an unexpected response shape.", cause)),
  );
});
