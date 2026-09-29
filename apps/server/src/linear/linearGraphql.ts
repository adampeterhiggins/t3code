import { LinearError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { LINEAR_GRAPHQL_URL } from "./linearOAuth.ts";

const GraphqlErrors = Schema.Array(
  Schema.Struct({
    message: Schema.String,
    extensions: Schema.optional(
      Schema.Struct({
        code: Schema.optional(Schema.String),
        userPresentableMessage: Schema.optional(Schema.String),
      }),
    ),
  }),
);

const GraphqlEnvelope = Schema.Struct({
  data: Schema.optional(Schema.NullOr(Schema.Unknown)),
  errors: Schema.optional(GraphqlErrors),
});
const decodeEnvelope = Schema.decodeUnknownEffect(GraphqlEnvelope);

const apiError = (detail: string, cause?: unknown) =>
  new LinearError({ reason: "api", detail, ...(cause === undefined ? {} : { cause }) });

/**
 * Runs one Linear GraphQL query with an OAuth access token. Linear can answer
 * HTTP 200 with both `data` and `errors`; any `errors` entry fails the query.
 */
export const linearGraphqlRequest = Effect.fn("linear.graphql")(function* <S extends Schema.Top>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  data: S,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
    HttpClientRequest.bearerToken(accessToken),
    HttpClientRequest.bodyJsonUnsafe({ query, variables }),
    httpClient.execute,
    Effect.mapError((cause) => apiError("Could not reach Linear.", cause)),
  );
  if (response.status === 401) {
    return yield* new LinearError({
      reason: "revoked",
      detail: "Linear rejected the stored credential. Reconnect Linear in Settings.",
    });
  }
  const body = yield* response.json.pipe(
    Effect.flatMap(decodeEnvelope),
    Effect.mapError((cause) =>
      apiError(`Linear returned an unreadable response (${response.status}).`, cause),
    ),
  );
  const errors = body.errors ?? [];
  if (response.status === 429 || errors.some((e) => e.extensions?.code === "RATELIMITED")) {
    return yield* new LinearError({
      reason: "rate-limited",
      detail: "Linear's rate limit was reached. Try again in a minute.",
    });
  }
  const firstError = errors[0];
  if (firstError !== undefined) {
    const detail = firstError.extensions?.userPresentableMessage ?? firstError.message;
    return yield* new LinearError({
      reason: /not found/i.test(detail) ? "not-found" : "api",
      detail,
    });
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* apiError(`Linear returned HTTP ${response.status}.`);
  }
  return yield* Schema.decodeUnknownEffect(data)(body.data).pipe(
    Effect.mapError((cause) => apiError("Linear returned an unexpected response shape.", cause)),
  );
});
