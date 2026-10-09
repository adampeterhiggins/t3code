import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeCliproxyApi } from "./cliproxyApi.ts";

const config = {
  kind: "cliproxy",
  url: "http://hub.test:8317",
  managementKey: "management-secret",
  enabled: true,
} as const;
const accounts = [
  {
    id: "first.json",
    auth_index: "a",
    provider: "codex",
    email: "first@example.com",
    id_token: { chatgpt_account_id: "account-a" },
  },
  {
    id: "second.json",
    auth_index: "b",
    provider: "codex",
    email: "second@example.com",
    id_token: { chatgpt_account_id: "account-b" },
  },
];
const credit = (id: string, expires_at = "2099-01-01T00:00:00Z") => ({
  id,
  expires_at,
  status: "available",
  reset_type: "codex_rate_limits",
});
const RequestBody = Schema.Struct({
  auth_index: Schema.String,
  method: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  header: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  data: Schema.optional(Schema.String),
});
type RequestBody = typeof RequestBody.Type;
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(RequestBody));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function fixture(
  options: {
    accounts?: ReadonlyArray<
      Omit<(typeof accounts)[number], "email" | "id_token"> & {
        email?: string;
        disabled?: boolean;
        project_id?: string;
        id_token?: (typeof accounts)[number]["id_token"];
      }
    >;
    upstream?: (request: RequestBody) => { status: number; body: unknown };
    cooldownStatus?: number;
  } = {},
) {
  const requests: Array<{ path: string; body?: RequestBody }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.headers.authorization).toBe("Bearer management-secret");
      const path = new URL(request.url).pathname;
      const body =
        request.body._tag === "Uint8Array"
          ? decodeRequest(new TextDecoder().decode(request.body.body))
          : undefined;
      requests.push({ path, ...(body ? { body } : {}) });
      if (path.endsWith("/auth-files"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ files: options.accounts ?? accounts }),
        );
      if (path.endsWith("/reset-quota"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({}, { status: options.cooldownStatus ?? 200 }),
        );
      expect(path).toBe("/v0/management/api-call");
      if (body?.header?.Authorization !== undefined) {
        expect(body.header.Authorization).toBe("Bearer $TOKEN$");
      }
      const upstream = options.upstream?.(body!) ?? {
        status: 200,
        body: body?.url?.endsWith("/consume")
          ? { code: "reset" }
          : body?.url?.endsWith("/rate-limit-reset-credits")
            ? {
                credits: [
                  credit("later", "2099-02-01T00:00:00Z"),
                  credit("first"),
                  credit("expired", "2000-01-01T00:00:00Z"),
                  { ...credit("used"), status: "redeemed" },
                ],
              }
            : {
                plan_type: "pro",
                rate_limit: {
                  secondary_window: {
                    used_percent: 78,
                    reset_at: 4070908800,
                    limit_window_seconds: 604800,
                  },
                },
              },
      };
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ status_code: upstream.status, body: encodeJson(upstream.body) }),
      );
    }),
  );
  return {
    requests,
    api: makeCliproxyApi.pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provide(NodeCrypto.layer),
    ),
  };
}

describe("CLIProxyAPI built-in management API", () => {
  it.effect(
    "reads both accounts and their earliest unexpired credits without plugin endpoints",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(1788710400000);
        const test = fixture();
        const api = yield* test.api;
        const result = yield* api.readAccounts(config);
        expect(result.map((account) => account.usageLimits.resetCredits)).toEqual([
          { availableCount: 2, nextCreditId: "first", nextExpiresAt: "2099-01-01T00:00:00.000Z" },
          { availableCount: 2, nextCreditId: "first", nextExpiresAt: "2099-01-01T00:00:00.000Z" },
        ]);
        expect(result[0]?.usageLimits.windows).toMatchObject([
          { id: "secondary", usedPercent: 78, kind: "weekly" },
        ]);
        const calls = test.requests.filter((request) => request.body?.url);
        expect(calls.map((request) => request.body?.auth_index).sort()).toEqual([
          "a",
          "a",
          "b",
          "b",
        ]);
        expect(
          calls.find((request) => request.body?.auth_index === "b")?.body?.header?.[
            "Chatgpt-Account-Id"
          ],
        ).toBe("account-b");
      }),
  );

  it.effect("keeps usage when the credits endpoint fails", () =>
    Effect.gen(function* () {
      const test = fixture({
        upstream: (request) =>
          request.url?.endsWith("rate-limit-reset-credits")
            ? { status: 503, body: { token: "do-not-publish" } }
            : { status: 200, body: { rate_limit: { primary_window: { used_percent: 12 } } } },
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(result[0]?.usageLimits.windows[0]?.usedPercent).toBe(12);
      expect(result[0]?.usageLimits.resetCredits).toBeUndefined();
    }),
  );

  it.effect("isolates a failed account and never publishes upstream error bodies", () =>
    Effect.gen(function* () {
      const test = fixture({
        upstream: (request) =>
          request.auth_index === "a"
            ? { status: 401, body: { token: "do-not-publish" } }
            : {
                status: 200,
                body: request.url?.endsWith("rate-limit-reset-credits")
                  ? { credits: [] }
                  : { rate_limit: { primary_window: { used_percent: 12 } } },
              },
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(result[0]?.usageLimits.unavailable?.reason).toBe("probeFailed");
      expect(result[1]?.usageLimits.windows[0]?.usedPercent).toBe(12);
      expect(encodeJson(result)).not.toContain("do-not-publish");
    }),
  );

  it.effect("maps Claude scoped windows without a scheduler plugin", () =>
    Effect.gen(function* () {
      const test = fixture({
        accounts: [{ ...accounts[0]!, provider: "claude" }],
        upstream: () => ({
          status: 200,
          body: {
            five_hour: { utilization: 10, resets_at: null },
            seven_day: { utilization: 50, resets_at: "2099-01-01T00:00:00Z" },
            limits: [
              {
                kind: "weekly_scoped",
                percent: 80,
                resets_at: null,
                scope: { model: { display_name: "Fable" } },
              },
            ],
          },
        }),
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(
        result[0]?.usageLimits.windows.map((window) => [window.id, window.usedPercent]),
      ).toEqual([
        ["five_hour", 10],
        ["seven_day", 50],
        ["seven_day_fable", 80],
      ]);
    }),
  );

  it.effect("pins redemption to the displayed credit and clears only that account's cooldown", () =>
    Effect.gen(function* () {
      const test = fixture();
      const api = yield* test.api;
      expect(yield* api.consume(config, "second.json", "credit-b")).toEqual({ outcome: "reset" });
      expect(yield* api.consume(config, "second.json", "credit-b")).toEqual({ outcome: "reset" });
      const redemptions = test.requests.filter((request) =>
        request.body?.url?.endsWith("/consume"),
      );
      expect(redemptions).toHaveLength(2);
      expect(redemptions[0]?.body?.data).toBe(redemptions[1]?.body?.data);
      expect(redemptions[0]?.body?.data).toBe(
        encodeJson({
          // UUIDv5 of "account-b:credit-b"; must stay stable so retries deduplicate.
          redeem_request_id: "519d5243-011a-5b7b-91f3-44d85f095705",
          credit_id: "credit-b",
        }),
      );
      expect(
        test.requests
          .filter((request) => request.path.endsWith("/reset-quota"))
          .map((request) => request.body?.auth_index),
      ).toEqual(["b", "b"]);
    }),
  );

  it.effect.each([
    ["nothing_to_reset", "nothingToReset"],
    ["no_credit", "noCredit"],
    ["already_redeemed", "alreadyRedeemed"],
  ] as const)("reports %s accurately", ([code, outcome]) =>
    Effect.gen(function* () {
      const test = fixture({ upstream: () => ({ status: 200, body: { code } }) });
      const api = yield* test.api;
      expect(yield* api.consume(config, "first.json", "credit")).toEqual({ outcome });
      expect(test.requests.some((request) => request.path.endsWith("/reset-quota"))).toBe(
        code === "already_redeemed",
      );
    }),
  );

  it.effect("reports redemption success even if cooldown clearing fails", () =>
    Effect.gen(function* () {
      const api = yield* fixture({ cooldownStatus: 404 }).api;
      const result = yield* api.consume(config, "first.json", "credit");
      expect(result.outcome).toBe("reset");
      expect(result.warning).toContain("cooldown");
    }),
  );

  it.effect("skips disabled accounts and rejects redemption on them", () =>
    Effect.gen(function* () {
      const test = fixture({ accounts: [{ ...accounts[0]!, disabled: true }] });
      const api = yield* test.api;
      expect(yield* api.readAccounts(config)).toEqual([]);
      expect((yield* api.consume(config, "first.json", "credit").pipe(Effect.result))._tag).toBe(
        "Failure",
      );
      expect(test.requests.every((request) => request.path.endsWith("/auth-files"))).toBe(true);
    }),
  );

  it.effect("keeps the same redemption id after an uncertain upstream failure", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const test = fixture({
        upstream: () =>
          ++attempts === 1
            ? { status: 503, body: {} }
            : { status: 200, body: { code: "already_redeemed" } },
      });
      const api = yield* test.api;
      expect((yield* api.consume(config, "first.json", "credit").pipe(Effect.result))._tag).toBe(
        "Failure",
      );
      expect(yield* api.consume(config, "first.json", "credit")).toEqual({
        outcome: "alreadyRedeemed",
      });
      const data = test.requests
        .filter((request) => request.body?.url?.endsWith("/consume"))
        .map((request) => request.body?.data);
      expect(data[0]).toBe(data[1]);
      expect(test.requests.filter((request) => request.path.endsWith("/reset-quota"))).toHaveLength(
        1,
      );
    }),
  );

  it.effect("rejects unknown accounts without forwarding a redemption", () =>
    Effect.gen(function* () {
      const test = fixture();
      const api = yield* test.api;
      const result = yield* api.consume(config, "missing.json", "credit").pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(test.requests).toHaveLength(1);
    }),
  );

  it.effect("reads Grok subscription usage from the billing status endpoint", () =>
    Effect.gen(function* () {
      const test = fixture({
        accounts: [
          {
            id: "grok.json",
            auth_index: "g",
            provider: "x-ai",
            email: "grok@example.com",
          },
        ],
        upstream: () => ({
          status: 200,
          body: {
            config: {
              creditUsagePercent: 25,
              currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2099-01-01T00:00:00Z" },
            },
          },
        }),
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(result[0]?.driver).toBe("grok");
      expect(result[0]?.usageLimits.windows).toMatchObject([
        {
          id: "subscription",
          kind: "weekly",
          usedPercent: 25,
          resetsAt: "2099-01-01T00:00:00.000Z",
        },
      ]);
      const call = test.requests.find((request) => request.body?.url);
      expect(call?.body?.url).toBe("https://cli-chat-proxy.grok.com/v1/billing?format=credits");
      expect(call?.body?.header?.["x-xai-token-auth"]).toBe("xai-grok-cli");
    }),
  );

  it.effect("reads Antigravity quota and falls through an empty daily host", () =>
    Effect.gen(function* () {
      const test = fixture({
        accounts: [
          {
            id: "agy.json",
            auth_index: "agy",
            provider: "gemini",
            email: "agy@example.com",
            project_id: "project-1",
          },
        ],
        upstream: (request) =>
          request.url?.includes("daily-cloudcode-pa")
            ? { status: 200, body: { groups: [] } }
            : {
                status: 200,
                body: {
                  groups: [
                    {
                      displayName: "Gemini Pro",
                      buckets: [
                        {
                          window: "5h",
                          remainingFraction: 0.25,
                          resetTime: "2099-01-01T00:00:00Z",
                        },
                      ],
                    },
                  ],
                },
              },
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(result[0]?.driver).toBe("antigravity");
      expect(result[0]?.usageLimits.windows).toMatchObject([
        {
          id: "gemini_pro_5h",
          kind: "session",
          label: "Gemini Pro · 5h",
          usedPercent: 75,
          resetsAt: "2099-01-01T00:00:00.000Z",
        },
      ]);
      expect(test.requests.flatMap((request) => request.body?.url ?? [])).toEqual([
        "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
        "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
        "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
      ]);
    }),
  );

  it.effect("discovers an Antigravity project before reading quota", () =>
    Effect.gen(function* () {
      const test = fixture({
        accounts: [{ id: "agy.json", auth_index: "agy", provider: "antigravity" }],
        upstream: (request) =>
          request.url?.endsWith(":loadCodeAssist")
            ? { status: 200, body: { cloudaicompanionProject: "discovered-project" } }
            : {
                status: 200,
                body: {
                  groups: [
                    {
                      displayName: "Claude",
                      buckets: [{ window: "weekly", remainingFraction: 0.5 }],
                    },
                  ],
                },
              },
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(result[0]?.usageLimits.windows).toMatchObject([
        { id: "claude_weekly", kind: "weekly", usedPercent: 50 },
      ]);
      const quota = test.requests.find((request) =>
        request.body?.url?.endsWith(":retrieveUserQuotaSummary"),
      );
      expect(quota?.body?.data).toBe(encodeJson({ project: "discovered-project" }));
    }),
  );

  it.effect("reads Devin and Kimi status endpoints and skips unknown providers", () =>
    Effect.gen(function* () {
      const test = fixture({
        accounts: [
          { id: "qwen.json", auth_index: "q", provider: "qwen" },
          { id: "devin.json", auth_index: "d", provider: "cognition", email: "devin@example.com" },
          { id: "kimi.json", auth_index: "k", provider: "kimi", email: "kimi@example.com" },
        ],
        upstream: (request) =>
          request.url?.includes("codeium.com")
            ? {
                status: 200,
                body: {
                  userStatus: {
                    planStatus: {
                      planInfo: { planName: "Pro" },
                      dailyQuotaRemainingPercent: 40,
                      weeklyQuotaRemainingPercent: "10",
                      weeklyQuotaResetAtUnix: 4070908800,
                    },
                  },
                },
              }
            : {
                status: 200,
                body: {
                  usage: { remaining: 20, limit: 100 },
                  limits: [
                    {
                      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
                      detail: { remaining: 90, limit: 100, resetTime: "2099-01-01T00:00:00Z" },
                    },
                  ],
                },
              },
      });
      const api = yield* test.api;
      const result = yield* api.readAccounts(config);
      expect(result.map((account) => account.driver)).toEqual(["devin", "kimi"]);
      expect(result[0]?.plan).toBe("Pro");
      expect(result[0]?.usageLimits.windows).toMatchObject([
        { id: "weekly", kind: "weekly", usedPercent: 90, resetsAt: "2099-01-01T00:00:00.000Z" },
        { id: "daily", kind: "other", usedPercent: 60 },
      ]);
      expect(result[1]?.usageLimits.windows).toMatchObject([
        { id: "session_0", kind: "session", label: "Session", usedPercent: 10 },
        { id: "weekly", kind: "weekly", usedPercent: 80 },
      ]);
      const devin = test.requests.find((request) => request.body?.auth_index === "d");
      expect(devin?.body?.data).toContain('"$TOKEN$"');
      expect(devin?.body?.header?.["Connect-Protocol-Version"]).toBe("1");
      expect(test.requests.some((request) => request.body?.auth_index === "q")).toBe(false);
    }),
  );
});
