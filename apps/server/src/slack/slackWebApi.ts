import { SlackError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { SLACK_API_URL } from "./slackOAuth.ts";

const Envelope = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  needed: Schema.optional(Schema.String),
});
const decodeEnvelope = Schema.decodeUnknownEffect(Envelope);

const REVOKED_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);
const NOT_FOUND_ERRORS = new Set([
  "channel_not_found",
  "thread_not_found",
  "message_not_found",
  "not_in_channel",
]);

const apiError = (detail: string, cause?: unknown) =>
  new SlackError({ reason: "api", detail, ...(cause === undefined ? {} : { cause }) });
const rateLimited = () =>
  new SlackError({
    reason: "rate-limited",
    detail: "Slack's rate limit was reached. Try again in a minute.",
  });

/** Maps Slack's `{ ok: false, error }` codes onto the reasons clients act on. */
function toSlackError(error: string, needed: string | undefined): SlackError {
  if (REVOKED_ERRORS.has(error)) {
    return new SlackError({
      reason: "revoked",
      detail: "Slack rejected the stored credential. Reconnect Slack in Settings → Integrations.",
    });
  }
  if (NOT_FOUND_ERRORS.has(error)) {
    return new SlackError({
      reason: "not-found",
      detail: "Your Slack account can't see that conversation.",
    });
  }
  if (error === "ratelimited") return rateLimited();
  if (error === "missing_scope") {
    return apiError(
      `The Slack app is missing the ${needed ?? "required"} scope. Add it and reconnect Slack.`,
    );
  }
  return apiError(`Slack returned an error (${error}).`);
}

/**
 * Calls one Slack Web API method with a user token, form-encoded. Slack answers
 * HTTP 200 with `ok: false` for most failures, so the envelope decides first.
 */
export const slackApiRequest = Effect.fn("slack.web_api")(function* <S extends Schema.Top>(
  accessToken: string,
  method: string,
  params: Record<string, string>,
  data: S,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(`${SLACK_API_URL}/${method}`).pipe(
    HttpClientRequest.bearerToken(accessToken),
    HttpClientRequest.bodyUrlParams(params),
    httpClient.execute,
    Effect.mapError((cause) => apiError("Could not reach Slack.", cause)),
  );
  if (response.status === 429) return yield* rateLimited();
  const json = yield* response.json.pipe(
    Effect.mapError((cause) =>
      apiError(`Slack returned an unreadable response (${response.status}).`, cause),
    ),
  );
  const envelope = yield* decodeEnvelope(json).pipe(
    Effect.mapError((cause) =>
      apiError(`Slack returned an unreadable response (${response.status}).`, cause),
    ),
  );
  if (!envelope.ok) return yield* toSlackError(envelope.error ?? "unknown_error", envelope.needed);
  if (response.status < 200 || response.status >= 300) {
    return yield* apiError(`Slack returned HTTP ${response.status}.`);
  }
  return yield* Schema.decodeUnknownEffect(data)(json).pipe(
    Effect.mapError((cause) => apiError("Slack returned an unexpected response shape.", cause)),
  );
});
