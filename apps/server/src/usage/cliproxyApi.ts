import {
  ProviderDriverKind,
  UsageLimitSourceError,
  type ProviderConsumeResetCreditResult,
  type ServerProviderUsageWindow,
  type UsageLimitSourceAccount,
  type UsageLimitSourceConfig,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { claudeUsageResponseToLimits } from "../provider/claudeUsageLimits.ts";
import { codexPlanLabel } from "../provider/CodexProvider.ts";
import { codexRateLimitsToLimits } from "../provider/codexUsageLimits.ts";
import { GrokUsageResponse, grokUsageResponseToLimits } from "@t3tools/provider-grok/server";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

const AuthFile = Schema.Struct({
  id: Schema.String,
  auth_index: Schema.String,
  provider: Schema.String,
  email: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
  id_token: Schema.optional(
    Schema.Struct({
      chatgpt_account_id: Schema.optional(Schema.String),
      chatgpt_plan_type: Schema.optional(Schema.String),
    }),
  ),
  project_id: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Struct({
      project_id: Schema.optional(Schema.String),
      projectId: Schema.optional(Schema.String),
    }),
  ),
});
const AuthFiles = Schema.Struct({ files: Schema.Array(AuthFile) });
const ApiResponse = Schema.Struct({ status_code: Schema.Number, body: Schema.String });
const CodexWindow = Schema.Struct({
  used_percent: Schema.Number,
  reset_at: Schema.optional(Schema.NullOr(Schema.Number)),
  limit_window_seconds: Schema.optional(Schema.Number),
});
const CodexUsage = Schema.Struct({
  plan_type: Schema.optional(Schema.String),
  rate_limit: Schema.NullOr(
    Schema.Struct({
      primary_window: Schema.optional(Schema.NullOr(CodexWindow)),
      secondary_window: Schema.optional(Schema.NullOr(CodexWindow)),
    }),
  ),
});
const ClaudeWindow = Schema.Struct({
  utilization: Schema.Number,
  resets_at: Schema.NullOr(Schema.String),
});
const ClaudeUsage = Schema.Struct({
  five_hour: Schema.optional(Schema.NullOr(ClaudeWindow)),
  seven_day: Schema.optional(Schema.NullOr(ClaudeWindow)),
  limits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        percent: Schema.optional(Schema.NullOr(Schema.Number)),
        resets_at: Schema.optional(Schema.NullOr(Schema.String)),
        scope: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              model: Schema.optional(Schema.NullOr(Schema.Struct({ display_name: Schema.String }))),
            }),
          ),
        ),
      }),
    ),
  ),
});
const CreditList = Schema.Struct({
  credits: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      reset_type: Schema.String,
      expires_at: Schema.String,
    }),
  ),
});
const AntigravityBucket = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remainingFraction: Schema.optional(Schema.Number),
  remaining_fraction: Schema.optional(Schema.Number),
  resetTime: Schema.optional(Schema.NullOr(Schema.String)),
  reset_time: Schema.optional(Schema.NullOr(Schema.String)),
});
const AntigravityQuota = Schema.Struct({
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        displayName: Schema.optional(Schema.String),
        display_name: Schema.optional(Schema.String),
        buckets: Schema.optional(Schema.Array(AntigravityBucket)),
      }),
    ),
  ),
});
const CodeAssistProject = Schema.Union([
  Schema.String,
  Schema.Struct({ id: Schema.optional(Schema.String) }),
]);
const CodeAssist = Schema.Struct({
  cloudaicompanionProject: Schema.optional(CodeAssistProject),
});
const KimiDetail = Schema.Struct({
  remaining: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  resetTime: Schema.optional(Schema.NullOr(Schema.String)),
  reset_at: Schema.optional(Schema.NullOr(Schema.String)),
  resetAt: Schema.optional(Schema.NullOr(Schema.String)),
});
const KimiUsage = Schema.Struct({
  usage: Schema.optional(KimiDetail),
  limits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        window: Schema.optional(
          Schema.Struct({
            duration: Schema.optional(Schema.Number),
            timeUnit: Schema.optional(Schema.String),
          }),
        ),
        detail: Schema.optional(KimiDetail),
      }),
    ),
  ),
});
const QuotaNumber = Schema.Union([Schema.Number, Schema.String]);
const DevinQuota = Schema.Struct({
  userStatus: Schema.optional(
    Schema.Struct({
      planStatus: Schema.optional(
        Schema.Struct({
          planInfo: Schema.optional(Schema.Struct({ planName: Schema.optional(Schema.String) })),
          dailyQuotaRemainingPercent: Schema.optional(QuotaNumber),
          weeklyQuotaRemainingPercent: Schema.optional(QuotaNumber),
          dailyQuotaResetAtUnix: Schema.optional(QuotaNumber),
          weeklyQuotaResetAtUnix: Schema.optional(QuotaNumber),
        }),
      ),
    }),
  ),
});

const decodeAuthFiles = Schema.decodeUnknownEffect(AuthFiles);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeApiResponse = Schema.decodeUnknownEffect(ApiResponse);
const decodeCreditList = Schema.decodeUnknownEffect(Schema.fromJsonString(CreditList));
const decodeClaudeUsage = Schema.decodeUnknownEffect(Schema.fromJsonString(ClaudeUsage));
const decodeCodexUsage = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexUsage));
const decodeGrokUsage = Schema.decodeUnknownEffect(Schema.fromJsonString(GrokUsageResponse));
const decodeAntigravityQuota = Schema.decodeUnknownEffect(Schema.fromJsonString(AntigravityQuota));
const decodeCodeAssist = Schema.decodeUnknownEffect(Schema.fromJsonString(CodeAssist));
const decodeKimiUsage = Schema.decodeUnknownEffect(Schema.fromJsonString(KimiUsage));
const decodeDevinQuota = Schema.decodeUnknownEffect(Schema.fromJsonString(DevinQuota));
const isUsageLimitSourceError = Schema.is(UsageLimitSourceError);
const decodeConsumeResponse = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      code: Schema.Literals(["reset", "nothing_to_reset", "no_credit", "already_redeemed"]),
    }),
  ),
);

const CODEX_BASE = "https://chatgpt.com/backend-api/wham";
const CREDIT_URL = `${CODEX_BASE}/rate-limit-reset-credits`;

// 6f1c2a9e-2d4b-4c1e-9a7f-3b8d5e0c1a42
const CREDIT_REDEEM_NAMESPACE = new Uint8Array([
  0x6f, 0x1c, 0x2a, 0x9e, 0x2d, 0x4b, 0x4c, 0x1e, 0x9a, 0x7f, 0x3b, 0x8d, 0x5e, 0x0c, 0x1a, 0x42,
]);

// UUIDv5 per account and credit also deduplicates retries across T3 environments.
const creditRedeemRequestId = Effect.fn("CliproxyApi.creditRedeemRequestId")(function* (
  accountId: string,
  creditId: string,
) {
  const crypto = yield* Crypto.Crypto;
  const name = new TextEncoder().encode(`${accountId}:${creditId}`);
  const input = new Uint8Array(CREDIT_REDEEM_NAMESPACE.length + name.length);
  input.set(CREDIT_REDEEM_NAMESPACE);
  input.set(name, CREDIT_REDEEM_NAMESPACE.length);
  const bytes = (yield* crypto.digest("SHA-1", input).pipe(Effect.orDie)).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Hex.encode(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
});

/**
 * Providers whose subscription status the hub can read. Names follow the
 * auth-file `provider` values CLIProxyAPI writes, including aliases.
 */
type HubProvider = "codex" | "claude" | "grok" | "antigravity" | "devin" | "kimi";

function hubProvider(provider: string): HubProvider | undefined {
  switch (provider.trim().toLowerCase().replaceAll("_", "-")) {
    case "codex":
      return "codex";
    case "claude":
    case "anthropic":
      return "claude";
    case "grok":
    case "xai":
    case "x-ai":
      return "grok";
    case "antigravity":
    case "anti-gravity":
    case "gemini":
      return "antigravity";
    case "devin":
    case "cognition":
      return "devin";
    case "kimi":
      return "kimi";
    default:
      return undefined;
  }
}

function driverFor(provider: HubProvider): ProviderDriverKind {
  switch (provider) {
    case "codex":
      return ProviderDriverKind.make("codex");
    case "claude":
      return ProviderDriverKind.make("claudeAgent");
    case "grok":
      return ProviderDriverKind.make("grok");
    case "antigravity":
      return ProviderDriverKind.make("antigravity");
    case "devin":
      return ProviderDriverKind.make("devin");
    case "kimi":
      return ProviderDriverKind.make("kimi");
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

const BEARER = "Bearer $TOKEN$";

function codexHeaders(account: typeof AuthFile.Type): Record<string, string> {
  return {
    Authorization: BEARER,
    "Content-Type": "application/json",
    "OpenAI-Beta": "codex-1",
    Originator: "Codex Desktop",
    ...(account.id_token?.chatgpt_account_id
      ? { "Chatgpt-Account-Id": account.id_token.chatgpt_account_id }
      : {}),
  };
}

const CLAUDE_HEADERS = {
  Authorization: BEARER,
  "anthropic-beta": "oauth-2025-04-20",
};
const GROK_USAGE_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const GROK_HEADERS = {
  Authorization: BEARER,
  "x-xai-token-auth": "xai-grok-cli",
  "x-grok-client-version": "0.2.91",
  accept: "*/*",
  "user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)",
};
// Antigravity traffic is served by the daily host; later hosts are fallbacks.
const ANTIGRAVITY_HOSTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
] as const;
const ANTIGRAVITY_HEADERS = {
  Authorization: BEARER,
  "Content-Type": "application/json",
  "User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
};
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const KIMI_HEADERS = { Authorization: BEARER };
const DEVIN_QUOTA_URL =
  "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus";
const DEVIN_HEADERS = {
  "Content-Type": "application/json",
  "Connect-Protocol-Version": "1",
};
// The hub replaces `$TOKEN$` in this JSON body before the request leaves.
const DEVIN_QUOTA_BODY = {
  metadata: {
    ideName: "chisel",
    ideVersion: "3000.10.21",
    apiKey: "$TOKEN$",
    locale: "en",
    os: "darwin",
    extensionVersion: "3000.10.21",
    clientName: "chisel",
  },
};

function isoTimestamp(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) return isoTimestamp(Number(trimmed));
    const parsed = DateTime.make(trimmed);
    return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : undefined;
  }
  if (!Number.isFinite(value)) return undefined;
  const millis = value < 100_000_000_000 ? value * 1000 : value;
  const parsed = DateTime.make(millis);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : undefined;
}

function windowId(...parts: ReadonlyArray<string>): string {
  const id = parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return id || "quota";
}

function finiteNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function usedFromRemainingFraction(fraction: number): number {
  return clampPercent((1 - Math.max(0, Math.min(1, fraction))) * 100);
}

function usedFromRemainingPercent(value: number | string | undefined): number | undefined {
  const remaining = finiteNumber(value);
  if (remaining === undefined || remaining < 0 || remaining > 100) return undefined;
  return clampPercent(100 - remaining);
}

function usedFromQuota(
  remaining: number | undefined,
  limit: number | undefined,
): number | undefined {
  if (
    remaining === undefined ||
    limit === undefined ||
    !Number.isFinite(remaining) ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    return undefined;
  }
  // A ratio such as 90/100 is not exactly 10 in binary floating point.
  return clampPercent(Math.round((1 - remaining / limit) * 1000) / 10);
}

function antigravityProjectId(account: typeof AuthFile.Type): string | undefined {
  return [
    account.project_id,
    account.projectId,
    account.metadata?.project_id,
    account.metadata?.projectId,
  ]
    .find((candidate) => candidate?.trim())
    ?.trim();
}

function codeAssistProject(project: typeof CodeAssistProject.Type | undefined): string | undefined {
  if (typeof project === "string") return project.trim() || undefined;
  return project?.id?.trim() || undefined;
}

function antigravityWindowKind(window: string): {
  readonly kind: ServerProviderUsageWindow["kind"];
  readonly label: string;
  readonly windowDurationMins?: number;
} {
  const normalized = window.trim().toLowerCase();
  if (normalized === "5h" || normalized === "five-hour" || normalized === "five_hour") {
    return { kind: "session", label: "5h", windowDurationMins: 5 * 60 };
  }
  if (normalized === "weekly" || normalized === "week") {
    return { kind: "weekly", label: "Weekly", windowDurationMins: 7 * 24 * 60 };
  }
  if (normalized === "monthly" || normalized === "month") {
    return { kind: "monthly", label: "Monthly" };
  }
  return { kind: "other", label: window.trim() || "Quota" };
}

function antigravityWindows(quota: typeof AntigravityQuota.Type): ServerProviderUsageWindow[] {
  const seen = new Map<string, number>();
  const windows: ServerProviderUsageWindow[] = [];
  for (const group of quota.groups ?? []) {
    const groupName = (group.displayName ?? group.display_name ?? "").trim();
    for (const bucket of group.buckets ?? []) {
      const fraction = bucket.remainingFraction ?? bucket.remaining_fraction;
      if (fraction === undefined || !Number.isFinite(fraction)) continue;
      const windowName = (bucket.window ?? bucket.displayName ?? bucket.display_name ?? "").trim();
      const kind = antigravityWindowKind(windowName);
      const label = groupName ? `${groupName} · ${kind.label}` : kind.label;
      const baseId = windowId(groupName, windowName || kind.label);
      const count = seen.get(baseId) ?? 0;
      seen.set(baseId, count + 1);
      const resetsAt = isoTimestamp(bucket.resetTime ?? bucket.reset_time);
      windows.push({
        id: count === 0 ? baseId : `${baseId}_${count + 1}`,
        kind: kind.kind,
        label,
        usedPercent: usedFromRemainingFraction(fraction),
        ...(kind.windowDurationMins !== undefined
          ? { windowDurationMins: kind.windowDurationMins }
          : {}),
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
  }
  return windows;
}

function kimiLimitWindow(
  detail: typeof KimiDetail.Type | undefined,
  label: string,
  kind: ServerProviderUsageWindow["kind"],
  id: string,
  windowDurationMins: number | undefined,
): ServerProviderUsageWindow | undefined {
  const usedPercent = usedFromQuota(detail?.remaining, detail?.limit);
  if (usedPercent === undefined) return undefined;
  const resetsAt = isoTimestamp(detail?.resetTime ?? detail?.reset_at ?? detail?.resetAt);
  return {
    id,
    kind,
    label,
    usedPercent,
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function kimiWindows(usage: typeof KimiUsage.Type): ServerProviderUsageWindow[] {
  const windows: ServerProviderUsageWindow[] = [];
  const weekly = kimiLimitWindow(usage.usage, "Weekly", "weekly", "weekly", 7 * 24 * 60);
  if (weekly) windows.push(weekly);
  for (const [index, limit] of (usage.limits ?? []).entries()) {
    const duration = limit.window?.duration;
    const unit = (limit.window?.timeUnit ?? "").toLowerCase().replace(/^time_unit_/, "");
    const minutes = unit.startsWith("minute") && duration !== undefined ? duration : undefined;
    const hours = unit.startsWith("hour") && duration !== undefined ? duration : undefined;
    const kind: ServerProviderUsageWindow["kind"] = unit.startsWith("week")
      ? "weekly"
      : unit.startsWith("month")
        ? "monthly"
        : minutes === 300 || hours === 5
          ? "session"
          : "other";
    const label =
      kind === "weekly"
        ? "Weekly"
        : kind === "monthly"
          ? "Monthly"
          : kind === "session"
            ? "Session"
            : minutes !== undefined
              ? minutes % 60 === 0
                ? `${minutes / 60}h`
                : `${minutes}m`
              : "Window";
    const durationMins =
      minutes ?? (hours !== undefined ? hours * 60 : kind === "weekly" ? 7 * 24 * 60 : undefined);
    const window = kimiLimitWindow(
      limit.detail,
      label,
      kind,
      windowId(label, String(index)),
      durationMins,
    );
    if (window) windows.push(window);
  }
  return windows;
}

function devinAccount(quota: typeof DevinQuota.Type): {
  readonly plan: string | undefined;
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
} {
  const planStatus = quota.userStatus?.planStatus;
  const plan = planStatus?.planInfo?.planName?.trim() || undefined;
  const windows: ServerProviderUsageWindow[] = [];
  const daily = usedFromRemainingPercent(planStatus?.dailyQuotaRemainingPercent);
  if (daily !== undefined) {
    const resetsAt = isoTimestamp(finiteNumber(planStatus?.dailyQuotaResetAtUnix));
    windows.push({
      id: "daily",
      kind: "other",
      label: "Daily",
      usedPercent: daily,
      windowDurationMins: 24 * 60,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  const weekly = usedFromRemainingPercent(planStatus?.weeklyQuotaRemainingPercent);
  if (weekly !== undefined) {
    const resetsAt = isoTimestamp(finiteNumber(planStatus?.weeklyQuotaResetAtUnix));
    windows.push({
      id: "weekly",
      kind: "weekly",
      label: "Weekly",
      usedPercent: weekly,
      windowDurationMins: 7 * 24 * 60,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return { plan, windows };
}

export const makeCliproxyApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;

  const management = Effect.fn("CliproxyApi.management")(function* (
    config: UsageLimitSourceConfig,
    path: string,
    body?: unknown,
  ) {
    const url = yield* Effect.try({
      try: () => new URL(`/v0/management/${path}`, config.url).toString(),
      catch: () => new UsageLimitSourceError({ detail: "The hub URL is not valid." }),
    });
    const request = (
      body === undefined ? HttpClientRequest.get(url) : HttpClientRequest.post(url)
    ).pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${config.managementKey}`));
    const response = yield* client
      .execute(body === undefined ? request : request.pipe(HttpClientRequest.bodyJsonUnsafe(body)))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.timeout("15 seconds"),
        Effect.mapError(
          () => new UsageLimitSourceError({ detail: "The hub management request failed." }),
        ),
      );
    return response;
  });

  const authFiles = Effect.fn("CliproxyApi.authFiles")(function* (config: UsageLimitSourceConfig) {
    const response = yield* management(config, "auth-files");
    return (yield* decodeAuthFiles(response)).files;
  });

  const apiCall = Effect.fn("CliproxyApi.apiCall")(function* (
    config: UsageLimitSourceConfig,
    account: typeof AuthFile.Type,
    url: string,
    options: { readonly header: Record<string, string>; readonly data?: unknown },
  ) {
    const raw = yield* management(config, "api-call", {
      auth_index: account.auth_index,
      method: options.data === undefined ? "GET" : "POST",
      url,
      header: options.header,
      ...(options.data === undefined ? {} : { data: yield* encodeJson(options.data) }),
    });
    const response = yield* decodeApiResponse(raw);
    if (response.status_code < 200 || response.status_code >= 300) {
      return yield* new UsageLimitSourceError({
        detail: `The provider refused the hub request (HTTP ${response.status_code}).`,
      });
    }
    return response.body;
  });

  const credits = Effect.fn("CliproxyApi.credits")(function* (
    config: UsageLimitSourceConfig,
    account: typeof AuthFile.Type,
  ) {
    const body = yield* apiCall(config, account, CREDIT_URL, { header: codexHeaders(account) });
    const response = yield* decodeCreditList(body);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    return response.credits
      .filter(
        (credit) =>
          credit.reset_type === "codex_rate_limits" &&
          credit.status === "available" &&
          Date.parse(credit.expires_at) > now,
      )
      .toSorted((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
  });

  const readAntigravityLimits = Effect.fn("CliproxyApi.readAntigravityLimits")(function* (
    config: UsageLimitSourceConfig,
    account: typeof AuthFile.Type,
    checkedAt: string,
  ) {
    let project = antigravityProjectId(account);
    if (!project) {
      const discovered = yield* Effect.gen(function* () {
        const body = yield* apiCall(
          config,
          account,
          `${ANTIGRAVITY_HOSTS[0]}/v1internal:loadCodeAssist`,
          {
            header: ANTIGRAVITY_HEADERS,
            data: { metadata: { ideType: "ANTIGRAVITY" } },
          },
        );
        const resolved = codeAssistProject((yield* decodeCodeAssist(body)).cloudaicompanionProject);
        if (!resolved) {
          return yield* new UsageLimitSourceError({
            detail: "Antigravity account has no project.",
          });
        }
        return resolved;
      }).pipe(Effect.option);
      if (Option.isSome(discovered)) project = discovered.value;
    }
    if (!project) {
      return yield* new UsageLimitSourceError({ detail: "Antigravity account has no project." });
    }
    for (const host of ANTIGRAVITY_HOSTS) {
      const body = yield* apiCall(config, account, `${host}/v1internal:retrieveUserQuotaSummary`, {
        header: ANTIGRAVITY_HEADERS,
        data: { project },
      }).pipe(Effect.result);
      if (body._tag === "Failure") continue;
      const quota = yield* decodeAntigravityQuota(body.success).pipe(Effect.option);
      if (Option.isNone(quota)) continue;
      const windows = antigravityWindows(quota.value);
      if (windows.length === 0) continue;
      return makeUsageLimits({ checkedAt, windows });
    }
    return yield* new UsageLimitSourceError({
      detail: "Antigravity returned no quota windows.",
    });
  });

  const readAccount = Effect.fn("CliproxyApi.readAccount")(function* (
    config: UsageLimitSourceConfig,
    account: typeof AuthFile.Type,
    provider: HubProvider,
  ) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const base = {
      id: account.id,
      driver: driverFor(provider),
      ...(account.email ? { email: account.email } : {}),
    };
    const read = Effect.gen(function* () {
      switch (provider) {
        case "claude": {
          const body = yield* apiCall(
            config,
            account,
            "https://api.anthropic.com/api/oauth/usage",
            {
              header: CLAUDE_HEADERS,
            },
          );
          const usage = yield* decodeClaudeUsage(body);
          const model_scoped = (usage.limits ?? []).flatMap((limit) =>
            limit.kind === "weekly_scoped" &&
            limit.scope?.model &&
            typeof limit.percent === "number"
              ? [
                  {
                    display_name: limit.scope.model.display_name,
                    utilization: limit.percent,
                    resets_at: limit.resets_at ?? null,
                  },
                ]
              : [],
          );
          return {
            ...base,
            plan: "Claude Subscription",
            usageLimits: claudeUsageResponseToLimits({
              checkedAt,
              response: {
                rate_limits_available: true,
                rate_limits: {
                  five_hour: usage.five_hour ?? null,
                  seven_day: usage.seven_day ?? null,
                  model_scoped,
                },
              },
            }).limits,
          };
        }
        case "grok": {
          const body = yield* apiCall(config, account, GROK_USAGE_URL, { header: GROK_HEADERS });
          return {
            ...base,
            usageLimits: grokUsageResponseToLimits(yield* decodeGrokUsage(body), checkedAt),
          };
        }
        case "antigravity":
          return {
            ...base,
            usageLimits: yield* readAntigravityLimits(config, account, checkedAt),
          };
        case "devin": {
          const body = yield* apiCall(config, account, DEVIN_QUOTA_URL, {
            header: DEVIN_HEADERS,
            data: DEVIN_QUOTA_BODY,
          });
          const parsed = devinAccount(yield* decodeDevinQuota(body));
          return {
            ...base,
            ...(parsed.plan ? { plan: parsed.plan } : {}),
            usageLimits: makeUsageLimits({ checkedAt, windows: parsed.windows }),
          };
        }
        case "kimi": {
          const body = yield* apiCall(config, account, KIMI_USAGE_URL, { header: KIMI_HEADERS });
          return {
            ...base,
            usageLimits: makeUsageLimits({
              checkedAt,
              windows: kimiWindows(yield* decodeKimiUsage(body)),
            }),
          };
        }
        case "codex": {
          const body = yield* apiCall(config, account, `${CODEX_BASE}/usage`, {
            header: codexHeaders(account),
          });
          const usage = yield* decodeCodexUsage(body);
          const toWindow = (window: typeof CodexWindow.Type | null | undefined) =>
            window
              ? {
                  usedPercent: window.used_percent,
                  resetsAt: window.reset_at ?? null,
                  ...(window.limit_window_seconds === undefined
                    ? {}
                    : { windowDurationMins: window.limit_window_seconds / 60 }),
                }
              : null;
          // A credits outage must not hide successfully fetched quota windows.
          const available = yield* credits(config, account).pipe(
            Effect.orElseSucceed(() => undefined),
          );
          const next = available?.[0];
          return {
            ...base,
            plan: codexPlanLabel(usage.plan_type ?? account.id_token?.chatgpt_plan_type),
            usageLimits: {
              ...codexRateLimitsToLimits({
                checkedAt,
                snapshot: {
                  planType: usage.plan_type ?? null,
                  primary: toWindow(usage.rate_limit?.primary_window),
                  secondary: toWindow(usage.rate_limit?.secondary_window),
                },
              }),
              ...(available
                ? {
                    resetCredits: {
                      availableCount: available.length,
                      ...(next
                        ? {
                            nextCreditId: next.id,
                            nextExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(next.expires_at)),
                          }
                        : {}),
                    },
                  }
                : {}),
            },
          };
        }
        default: {
          const exhaustive: never = provider;
          return exhaustive;
        }
      }
    });
    return yield* read.pipe(
      Effect.orElseSucceed(() => ({
        ...base,
        usageLimits: makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "The hub could not read this account's usage.",
        }),
      })),
    );
  });

  const readAccounts = Effect.fn("CliproxyApi.readAccounts")(function* (
    config: UsageLimitSourceConfig,
  ): Effect.fn.Return<ReadonlyArray<UsageLimitSourceAccount>, UsageLimitSourceError> {
    const accounts = yield* authFiles(config).pipe(
      Effect.mapError(
        () => new UsageLimitSourceError({ detail: "The hub could not list accounts." }),
      ),
    );
    return yield* Effect.forEach(
      accounts.flatMap((account) => {
        if (account.disabled) return [];
        const provider = hubProvider(account.provider);
        return provider ? [{ account, provider }] : [];
      }),
      ({ account, provider }) => readAccount(config, account, provider),
      { concurrency: 4 },
    );
  });

  const consume = Effect.fn("CliproxyApi.consume")(function* (
    config: UsageLimitSourceConfig,
    accountId: string,
    creditId: string,
  ): Effect.fn.Return<ProviderConsumeResetCreditResult, UsageLimitSourceError> {
    const operation = Effect.gen(function* () {
      const account = (yield* authFiles(config)).find((account) => account.id === accountId);
      if (!account || account.disabled || account.provider !== "codex") {
        return yield* new UsageLimitSourceError({
          detail: "The Codex hub account is missing or disabled.",
        });
      }
      const body = yield* apiCall(config, account, `${CREDIT_URL}/consume`, {
        header: codexHeaders(account),
        data: {
          redeem_request_id: yield* creditRedeemRequestId(
            account.id_token?.chatgpt_account_id ?? account.id,
            creditId,
          ).pipe(Effect.provideService(Crypto.Crypto, crypto)),
          credit_id: creditId,
        },
      });
      const response = yield* decodeConsumeResponse(body);
      const outcome = (
        {
          reset: "reset",
          nothing_to_reset: "nothingToReset",
          no_credit: "noCredit",
          already_redeemed: "alreadyRedeemed",
        } as const
      )[response.code];
      if (outcome !== "reset" && outcome !== "alreadyRedeemed") return { outcome };
      const cleared = yield* management(config, "reset-quota", {
        auth_index: account.auth_index,
      }).pipe(Effect.result);
      return {
        outcome,
        ...(cleared._tag === "Failure"
          ? {
              warning:
                "Credit redeemed, but the hub cooldown could not be cleared. Routing may resume after its cooldown expires.",
            }
          : {}),
      } as const;
    });
    return yield* operation.pipe(
      Effect.mapError((error) =>
        isUsageLimitSourceError(error)
          ? error
          : new UsageLimitSourceError({
              detail: "The hub returned an unexpected reset-credit response.",
            }),
      ),
    );
  });
  return { readAccounts, consume };
});
