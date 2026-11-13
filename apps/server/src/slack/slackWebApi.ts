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
  "canvas_not_found",
  "file_not_found",
  "file_deleted",
  "not_visible",
  "list_not_found",
  "user_not_found",
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
      detail: "Your Slack account can't see that, or it no longer exists.",
    });
  }
  if (error === "ratelimited") return rateLimited();
  if (error === "missing_scope") {
    return apiError(
      `The Slack app is missing the ${needed ?? "required"} scope. Update the app from the manifest in Settings → Integrations → Slack, then reconnect.`,
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
  return yield* Schema.decodeEffect(data)(json).pipe(
    Effect.mapError((cause) => apiError("Slack returned an unexpected response shape.", cause)),
  );
});

/** Downloads a private file's text (`url_private_download`), which needs the same user token. */
const slackDownload = Effect.fnUntraced(function* (accessToken: string, url: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.bearerToken(accessToken),
    httpClient.execute,
    Effect.mapError((cause) => apiError("Could not reach Slack.", cause)),
  );
  if (response.status === 429) return yield* rateLimited();
  if (response.status < 200 || response.status >= 300) {
    return yield* apiError(`Slack returned HTTP ${response.status} for the file.`);
  }
  return response;
});

export const slackDownloadText = Effect.fn("slack.download_text")(function* (
  accessToken: string,
  url: string,
) {
  const response = yield* slackDownload(accessToken, url);
  return yield* response.text.pipe(
    Effect.mapError((cause) => apiError("Slack returned an unreadable file.", cause)),
  );
});

/** A file's bytes, or null when Slack answers with something other than `mimeType`. */
export const slackDownloadBytes = Effect.fn("slack.download_bytes")(function* (
  accessToken: string,
  url: string,
  mimeType: string,
) {
  const response = yield* slackDownload(accessToken, url);
  // Slack answers a download it will not serve with its sign-in page, as HTTP 200.
  const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== mimeType.toLowerCase()) return null;
  const buffer = yield* response.arrayBuffer.pipe(
    Effect.mapError((cause) => apiError("Slack returned an unreadable file.", cause)),
  );
  return new Uint8Array(buffer);
});
