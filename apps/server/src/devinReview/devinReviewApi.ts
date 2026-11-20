import { DevinReviewError, type DevinReviewPullRequestRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const DEVIN_API_URL = "https://api.devin.ai/v3";

export interface DevinCredentials {
  readonly method: "devin-login" | "service-key";
  readonly apiKey: string;
  readonly orgId: string;
}

export const PrReviewResponse = Schema.Struct({
  status: Schema.Literals(["pending", "running", "completed", "errored", "cancelled", "skipped"]),
  commit_sha: Schema.String,
  created_at: Schema.String,
});
export type PrReviewResponse = typeof PrReviewResponse.Type;
const decodePrReview = Schema.decodeUnknownEffect(PrReviewResponse);

/** RFC 9457 problem details, which every v3 error carries. */
const ProblemDetail = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeProblem = Schema.decodeUnknownOption(ProblemDetail);

export const DEVIN_UNREACHABLE = "Could not reach Devin.";

const apiError = (detail: string) => new DevinReviewError({ reason: "api", detail });

/**
 * Devin answers a key it does not recognise with 403 and the detail `Unauthorized`, not 401, so
 * both read as a revoked key. Any other 403 is a key without the permission the call needs.
 */
const isRevoked = (status: number, detail: string | undefined) =>
  status === 401 || (status === 403 && detail === "Unauthorized");

/**
 * One call to Devin's PR review endpoint. A GET answers null when Devin has no review of the
 * pull request's head commit.
 */
export const devinPrReviewRequest = Effect.fn("devin_review.api")(function* (
  credentials: DevinCredentials,
  method: "GET" | "POST",
  ref: DevinReviewPullRequestRef,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const prUrl = `https://github.com/${ref.repository}/pull/${ref.number}`;
  const url = `${DEVIN_API_URL}/organizations/${encodeURIComponent(credentials.orgId)}/pr-reviews`;
  const request =
    method === "GET"
      ? HttpClientRequest.get(url).pipe(HttpClientRequest.setUrlParams({ pr_url: prUrl }))
      : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe({ pr_url: prUrl }));
  const response = yield* request.pipe(
    HttpClientRequest.setHeader("authorization", `Bearer ${credentials.apiKey}`),
    HttpClientRequest.acceptJson,
    httpClient.execute,
    Effect.mapError(() => apiError(DEVIN_UNREACHABLE)),
  );
  const json = yield* response.json.pipe(Effect.orElseSucceed(() => null));
  if (response.status >= 200 && response.status < 300) {
    return yield* decodePrReview(json).pipe(
      Effect.mapError(() => apiError("Devin returned an unexpected response shape.")),
    );
  }
  const problem = Option.getOrUndefined(decodeProblem(json));
  const detail = problem?.detail ?? problem?.title ?? undefined;
  if (method === "GET" && response.status === 404) return null;
  if (isRevoked(response.status, detail)) {
    return yield* new DevinReviewError({
      reason: "revoked",
      detail: "Devin rejected the API key. Reconnect Devin Review in Settings → Integrations.",
    });
  }
  if (response.status === 403) {
    return yield* new DevinReviewError({
      reason: "forbidden",
      detail: `Devin refused the request${detail === undefined ? "" : ` (${detail})`}. The service user needs ${method === "GET" ? "ViewReview" : "UseReviewManual"} in organization ${credentials.orgId}.`,
    });
  }
  if (response.status === 429) {
    return yield* new DevinReviewError({
      reason: "rate-limited",
      detail: "Devin's rate limit was reached. Try again in a minute.",
    });
  }
  if (response.status === 404) {
    return yield* new DevinReviewError({
      reason: "not-found",
      detail: `Devin cannot review ${prUrl}${detail === undefined ? "" : ` (${detail})`}. Check that Devin Review is set up for the repository.`,
    });
  }
  return yield* apiError(
    detail === undefined
      ? `Devin returned HTTP ${response.status}.`
      : `Devin returned an error (${detail}).`,
  );
});

const DevinSelf = Schema.Struct({
  org_id: Schema.String,
  user_name: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeDevinSelf = Schema.decodeUnknownEffect(DevinSelf);

/**
 * Who a Devin token belongs to. The `devin` CLI's login token is accepted here and on the PR
 * review endpoints, which is what lets Devin Review reuse it. Null when Devin rejects the token.
 */
export const devinSelf = Effect.fn("devin_review.api.self")(function* (token: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.get(`${DEVIN_API_URL}/self`).pipe(
    HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
    HttpClientRequest.acceptJson,
    httpClient.execute,
    Effect.mapError(() => apiError(DEVIN_UNREACHABLE)),
  );
  if (response.status === 401 || response.status === 403) return null;
  if (response.status < 200 || response.status >= 300) {
    return yield* apiError(`Devin returned HTTP ${response.status}.`);
  }
  const self = yield* response.json.pipe(
    Effect.flatMap(decodeDevinSelf),
    Effect.mapError(() => apiError("Devin returned an unexpected response shape.")),
  );
  return { orgId: self.org_id, userName: self.user_name ?? null };
});

const CLI_TOKEN = /^\s*windsurf_api_key\s*=\s*"([^"]+)"/mu;

/** The login token in a `devin` CLI `credentials.toml`, if it holds one. */
export function devinCliToken(credentialsToml: string): string | null {
  return CLI_TOKEN.exec(credentialsToml)?.[1] ?? null;
}
