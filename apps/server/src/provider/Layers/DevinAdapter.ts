/**
 * DevinAdapterLive — Devin CLI (`devin acp`) via ACP.
 *
 * @module DevinAdapterLive
 */

import {
  ApprovalRequestId,
  type DevinSettings,
  type ProviderOptionSelection,
  EventId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { acpPermissionOutcome, mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpTokenUsageEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest, type AcpToolCallState } from "../acp/AcpRuntimeModel.ts";
import {
  DEVIN_RESOURCE_TEXT_MAX_CHARS,
  normalizeDevinResourceContent,
} from "../acp/DevinResourceSupport.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import { inferDevinContextWindowTokens } from "../devinModelCatalog.ts";
import {
  applyDevinAcpModelSelection,
  makeDevinAcpRuntime,
  resolveDevinModeId,
} from "../acp/DevinAcpSupport.ts";
import { prepareDevinMcp } from "../acp/DevinMcp.ts";
import { hasCandidateSkillMention, planDevinSkillDispatch } from "../Drivers/DevinSkillDispatch.ts";
import { discoverDevinSkills } from "../Drivers/DevinSkills.ts";
import { type DevinAdapterShape } from "../Services/DevinAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

const PROVIDER = ProviderDriverKind.make("devin");
const DEVIN_RESUME_VERSION = 1 as const;

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDevinResourceContent(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "content" || !isRecord(value.content)) {
    return false;
  }
  return value.content.type === "resource_link" || value.content.type === "resource";
}

function boundedDevinMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= DEVIN_RESOURCE_TEXT_MAX_CHARS
    ? value
    : undefined;
}

const DEVIN_TOOL_CALL_RAW_METADATA_FIELDS = [
  "sessionUpdate",
  "toolCallId",
  "title",
  "kind",
  "status",
] as const;

function sanitizeDevinToolCall(toolCall: AcpToolCallState): AcpToolCallState {
  const content = toolCall.data.content;
  if (!Array.isArray(content)) {
    return toolCall;
  }
  let changed = false;
  let resource = toolCall.data.resource;
  const retainedContent: Array<unknown> = [];
  for (const entry of content) {
    if (!isDevinResourceContent(entry)) {
      retainedContent.push(entry);
      continue;
    }
    changed = true;
    if (resource !== undefined) continue;
    const normalized = normalizeDevinResourceContent(entry);
    if (normalized.kind === "resource") {
      resource = normalized.resource;
    }
  }
  if (!changed) {
    return toolCall;
  }
  const data: Record<string, unknown> = { ...toolCall.data };
  if (retainedContent.length > 0) {
    data.content = retainedContent;
  } else {
    delete data.content;
  }
  if (resource !== undefined) {
    data.resource = resource;
  } else {
    delete data.resource;
  }
  return { ...toolCall, data };
}

function sanitizeDevinToolCallRawPayload(rawPayload: unknown, toolCall: AcpToolCallState): unknown {
  if (!isRecord(rawPayload) || !isRecord(rawPayload.update)) {
    return rawPayload;
  }
  const rawUpdate = rawPayload.update;
  const hasRawResource =
    Array.isArray(rawUpdate.content) && rawUpdate.content.some(isDevinResourceContent);
  if (!hasRawResource && toolCall.data.resource === undefined) {
    return rawPayload;
  }
  const update: Record<string, unknown> = {};
  for (const field of DEVIN_TOOL_CALL_RAW_METADATA_FIELDS) {
    const value = boundedDevinMetadata(rawUpdate[field]);
    if (value !== undefined) {
      update[field] = value;
    }
  }
  if (toolCall.data.resource !== undefined) {
    update.resource = toolCall.data.resource;
  }
  const sessionId = boundedDevinMetadata(rawPayload.sessionId);
  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    update,
  };
}

function sanitizeDevinPermissionRequest(params: EffectAcpSchema.RequestPermissionRequest) {
  const permissionRequest = parsePermissionRequest(params);
  if (!params.toolCall.content?.some(isDevinResourceContent)) {
    return { permissionRequest, payload: params };
  }
  const toolCall = permissionRequest.toolCall
    ? sanitizeDevinToolCall(permissionRequest.toolCall)
    : undefined;
  const metadata: Record<string, unknown> = {};
  for (const field of DEVIN_TOOL_CALL_RAW_METADATA_FIELDS) {
    const value = boundedDevinMetadata(Reflect.get(params.toolCall, field));
    if (value !== undefined) metadata[field] = value;
  }
  if (toolCall?.data.resource !== undefined) metadata.resource = toolCall.data.resource;
  const detail = boundedDevinMetadata(permissionRequest.detail);
  return {
    permissionRequest: {
      kind: permissionRequest.kind,
      ...(detail !== undefined ? { detail } : {}),
    },
    payload: {
      sessionId: boundedDevinMetadata(params.sessionId),
      toolCall: metadata,
      options: params.options.map(({ optionId, name, kind }) => ({
        optionId: boundedDevinMetadata(optionId),
        name: boundedDevinMetadata(name),
        kind,
      })),
    },
  };
}

export interface DevinAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  /**
   * Selections are honored when `modelSelection.instanceId` matches this value.
   * Defaults to the legacy built-in instance id (`devin`).
   */
  readonly instanceId?: ProviderInstanceId;
  /**
   * Optional per-session settings resolver. See `CursorAdapterLiveOptions`
   * for the rationale — tests that mutate settings mid-flight pass a resolver
   * so the spawn closure isn't stale.
   */
  readonly resolveSettings?: Effect.Effect<DevinSettings>;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface DevinAcpUsageTotals {
  readonly inputTokens: number;
  readonly cachedReadTokens: number;
  readonly cachedWriteTokens: number;
  readonly outputTokens: number;
  readonly thoughtTokens: number;
  readonly totalTokens: number;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function normalizeDevinAcpUsage(usage: EffectAcpSchema.Usage): DevinAcpUsageTotals {
  const inputTokens = nonNegativeInteger(usage.inputTokens);
  const outputTokens = nonNegativeInteger(usage.outputTokens);
  const cachedReadTokens = nonNegativeInteger(usage.cachedReadTokens);
  const cachedWriteTokens = nonNegativeInteger(usage.cachedWriteTokens);
  const thoughtTokens = nonNegativeInteger(usage.thoughtTokens);
  const reportedTotal = nonNegativeInteger(usage.totalTokens);
  const calculatedTotal = inputTokens + outputTokens + thoughtTokens;
  return {
    inputTokens,
    cachedReadTokens,
    cachedWriteTokens,
    outputTokens,
    thoughtTokens,
    totalTokens: Math.max(reportedTotal, calculatedTotal),
  };
}

function subtractDevinAcpUsage(
  current: DevinAcpUsageTotals,
  previous: DevinAcpUsageTotals | undefined,
): DevinAcpUsageTotals {
  const delta = (value: number, before: number | undefined) =>
    before === undefined || value < before ? value : value - before;
  return {
    inputTokens: delta(current.inputTokens, previous?.inputTokens),
    cachedReadTokens: delta(current.cachedReadTokens, previous?.cachedReadTokens),
    cachedWriteTokens: delta(current.cachedWriteTokens, previous?.cachedWriteTokens),
    outputTokens: delta(current.outputTokens, previous?.outputTokens),
    thoughtTokens: delta(current.thoughtTokens, previous?.thoughtTokens),
    totalTokens: delta(current.totalTokens, previous?.totalTokens),
  };
}

function acpCostAmountUsd(cost: EffectAcpSchema.Cost | null | undefined): number | undefined {
  if (!cost || !Number.isFinite(cost.amount) || cost.amount < 0) return undefined;
  return cost.currency.trim().toUpperCase() === "USD" ? cost.amount : undefined;
}

interface DevinSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  lastPlanFingerprint: string | undefined;
  activeTurnId: TurnId | undefined;
  /** Context meter state from the last `usage_update` session notification. */
  lastContextWindowUsed: number | undefined;
  lastContextWindowSize: number | undefined;
  /** Cumulative prompt usage last reported by ACP prompt responses. */
  lastAcpUsage: DevinAcpUsageTotals | undefined;
  /** Cumulative USD cost last reported on a `usage_update`. */
  lastAcpCostUsd: number | undefined;
  /** Cost delta accrued since the last prompt-usage event consumed it. */
  pendingCostDeltaUsd: number | undefined;
  /** Processed-token total derived from cumulative ACP usage. */
  totalProcessedTokens: number;
  /** The concrete uid applied to the session, for usage attribution. */
  activeModelUid: string | undefined;
  /** Number of sendTurn prompts currently in flight or being prepared.
   * >0 means a turn is actively running, so a new sendTurn is a steer that
   * continues it, and only the last remaining prompt settles the turn. */
  promptsInFlight: number;
  stopped: boolean;
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingApprovals.values());
  return Effect.forEach(
    pendingEntries,
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    {
      discard: true,
    },
  );
}

function settlePendingUserInputsAsEmptyAnswers(
  pendingUserInputs: ReadonlyMap<ApprovalRequestId, PendingUserInput>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingUserInputs.values());
  return Effect.forEach(
    pendingEntries,
    (pending) => Deferred.succeed(pending.answers, {}).pipe(Effect.ignore),
    {
      discard: true,
    },
  );
}

function parseDevinResume(raw: unknown): { sessionId: string } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== DEVIN_RESUME_VERSION) return undefined;
  if (typeof raw.sessionId !== "string" || !raw.sessionId.trim()) return undefined;
  return { sessionId: raw.sessionId.trim() };
}

function applyRequestedSessionConfiguration<E>(input: {
  readonly runtime: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly modelSelection:
    | {
        readonly model: string;
        readonly options?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
      }
    | undefined;
  readonly mapError: (context: {
    readonly cause: EffectAcpErrors.AcpError;
    readonly method: "session/set_config_option" | "session/set_mode";
  }) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    if (input.modelSelection) {
      yield* applyDevinAcpModelSelection({
        runtime: input.runtime,
        model: input.modelSelection.model,
        selections: input.modelSelection.options,
        mapError: ({ cause }) =>
          input.mapError({
            cause,
            method: "session/set_config_option",
          }),
      });
    }

    const requestedModeId = resolveDevinModeId({
      interactionMode: input.interactionMode,
      runtimeMode: input.runtimeMode,
      modeState: yield* input.runtime.getModeState,
    });
    if (!requestedModeId) {
      return;
    }

    yield* input.runtime.setMode(requestedModeId).pipe(
      Effect.mapError((cause) =>
        input.mapError({
          cause,
          method: "session/set_mode",
        }),
      ),
    );
  });
}

function selectAutoApprovedPermissionOption(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  const allowAlwaysOption = request.options.find((option) => option.kind === "allow_always");
  if (typeof allowAlwaysOption?.optionId === "string" && allowAlwaysOption.optionId.trim()) {
    return allowAlwaysOption.optionId.trim();
  }

  const allowOnceOption = request.options.find((option) => option.kind === "allow_once");
  if (typeof allowOnceOption?.optionId === "string" && allowOnceOption.optionId.trim()) {
    return allowOnceOption.optionId.trim();
  }

  return undefined;
}

/**
 * Map a `session/elicitation` form request to user-input questions. Enum
 * properties become fixed choices; everything else takes a custom answer.
 * URL-mode elicitations cannot be answered in the chat UI.
 */
function toElicitationContentValue(
  value: unknown,
): string | number | boolean | ReadonlyArray<string> | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const strings = value.filter((entry): entry is string => typeof entry === "string");
    return strings.length === value.length ? strings : undefined;
  }
  return undefined;
}

function extractElicitationQuestions(
  params: Extract<EffectAcpSchema.ElicitationRequest, { readonly mode: "form" }>,
): ReadonlyArray<UserInputQuestion> {
  const properties = params.requestedSchema.properties ?? {};
  return Object.entries(properties).map(([id, property]) => {
    const options =
      "enum" in property && Array.isArray(property.enum)
        ? property.enum
            .filter((value): value is string => typeof value === "string")
            .map((value) => ({ label: value, description: value }))
        : [];
    return {
      id,
      header: property.title?.trim() || id,
      question: property.description?.trim() || property.title?.trim() || params.message,
      options,
      allowCustomAnswer: true,
      multiSelect: property.type === "array",
    };
  });
}

export function makeDevinAdapter(devinSettings: DevinSettings, options?: DevinAdapterLiveOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("devin");
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* Effect.service(ServerConfig);
    const crypto = yield* Crypto.Crypto;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
    const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();

    const sessions = new Map<ThreadId, DevinSessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Devin runtime identifier.",
            cause,
          }),
      ),
    );
    const nextEventId = Effect.map(randomUUIDv4, (id) => EventId.make(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const mapRequestFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new EffectAcpErrors.AcpTransportError({
              detail: "Failed to process Devin ACP event.",
              cause,
            }),
        ),
      );

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
          current.get(threadId),
        );
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        });
      });

    const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const logNative = (threadId: ThreadId, method: string, payload: unknown) =>
      Effect.gen(function* () {
        if (!nativeEventLogger) return;
        const observedAt = yield* nowIso;
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: yield* randomUUIDv4,
              kind: "notification",
              provider: PROVIDER,
              createdAt: observedAt,
              method,
              threadId,
              payload,
            },
          },
          threadId,
        );
      });

    const emitPlanUpdate = (
      ctx: DevinSessionContext,
      payload: {
        readonly explanation?: string | null;
        readonly plan: ReadonlyArray<{
          readonly step: string;
          readonly status: "pending" | "inProgress" | "completed";
        }>;
      },
      rawPayload: unknown,
    ) =>
      Effect.gen(function* () {
        const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${encodeJsonStringForDiagnostics(payload) ?? "[unserializable payload]"}`;
        if (ctx.lastPlanFingerprint === fingerprint) {
          return;
        }
        ctx.lastPlanFingerprint = fingerprint;
        yield* offerRuntimeEvent(
          makeAcpPlanUpdatedEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            payload,
            source: "acp.jsonrpc",
            method: "session/update",
            rawPayload,
          }),
        );
      });

    const providerSessionIdFor = (ctx: DevinSessionContext): string | undefined =>
      parseDevinResume(ctx.session.resumeCursor)?.sessionId;

    /** The concrete uid currently applied to the session, when advertised. */
    const readActiveModelUid = (
      runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "getConfigOptions">,
    ) =>
      runtime.getConfigOptions.pipe(
        Effect.map((configOptions) => {
          const option = configOptions.find(
            (entry) => entry.category === "model" || entry.id === "model",
          );
          const currentValue =
            option && "currentValue" in option && typeof option.currentValue === "string"
              ? option.currentValue.trim()
              : "";
          return currentValue.length > 0 ? currentValue : undefined;
        }),
        Effect.catch(() => Effect.succeed(undefined)),
      );

    /** Emits the ACP context-window update used by the composer meter. */
    const emitDevinContextUsage = (
      ctx: DevinSessionContext,
      update: EffectAcpSchema.UsageUpdate,
      rawPayload: unknown,
    ) =>
      Effect.gen(function* () {
        const usedTokens = nonNegativeInteger(update.used);
        const reportedMaxTokens = nonNegativeInteger(update.size);
        const maxTokens =
          reportedMaxTokens > 0
            ? reportedMaxTokens
            : (inferDevinContextWindowTokens(ctx.activeModelUid ?? ctx.session.model) ?? 0);
        ctx.lastContextWindowUsed = usedTokens;
        ctx.lastContextWindowSize = maxTokens > 0 ? maxTokens : undefined;

        const sessionCostUsd = acpCostAmountUsd(update.cost);
        if (sessionCostUsd !== undefined) {
          const previousCost = ctx.lastAcpCostUsd;
          const costDelta =
            previousCost === undefined
              ? sessionCostUsd
              : Math.max(0, sessionCostUsd - previousCost);
          ctx.pendingCostDeltaUsd = (ctx.pendingCostDeltaUsd ?? 0) + costDelta;
          ctx.lastAcpCostUsd = sessionCostUsd;
        }

        const usage: ThreadTokenUsageSnapshot = {
          usedTokens,
          ...(ctx.totalProcessedTokens > 0
            ? { totalProcessedTokens: ctx.totalProcessedTokens }
            : {}),
          ...(maxTokens > 0 ? { maxTokens } : {}),
          ...((ctx.activeModelUid ?? ctx.session.model)
            ? { model: ctx.activeModelUid ?? ctx.session.model }
            : {}),
          ...(providerSessionIdFor(ctx) ? { providerSessionId: providerSessionIdFor(ctx) } : {}),
          ...(sessionCostUsd !== undefined ? { sessionCostUsd } : {}),
          ...(update.cost?.currency?.trim() ? { costCurrency: update.cost.currency.trim() } : {}),
        };

        yield* offerRuntimeEvent(
          makeAcpTokenUsageEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            usage,
            rawPayload,
          }),
        );
      });

    /** Emits turn token deltas and preserves cumulative ACP context data. */
    const emitDevinPromptUsage = (
      ctx: DevinSessionContext,
      usageInput: EffectAcpSchema.Usage | null | undefined,
      rawPayload: unknown,
    ) =>
      Effect.gen(function* () {
        if (!usageInput) return;

        const current = normalizeDevinAcpUsage(usageInput);
        const delta = subtractDevinAcpUsage(current, ctx.lastAcpUsage);
        const previousTotal = ctx.totalProcessedTokens;
        const reportedCumulative =
          ctx.lastAcpUsage !== undefined && current.totalTokens >= ctx.lastAcpUsage.totalTokens;
        const totalProcessedTokens = reportedCumulative
          ? Math.max(previousTotal, current.totalTokens)
          : previousTotal + delta.totalTokens;
        ctx.totalProcessedTokens = totalProcessedTokens;
        ctx.lastAcpUsage = current;

        const usedTokens = ctx.lastContextWindowUsed ?? 0;
        const maxTokens = ctx.lastContextWindowSize;
        const usage: ThreadTokenUsageSnapshot = {
          usedTokens,
          ...(totalProcessedTokens > 0 ? { totalProcessedTokens } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...((ctx.activeModelUid ?? ctx.session.model)
            ? { model: ctx.activeModelUid ?? ctx.session.model }
            : {}),
          ...(providerSessionIdFor(ctx) ? { providerSessionId: providerSessionIdFor(ctx) } : {}),
          inputTokens: current.inputTokens,
          cachedInputTokens: current.cachedReadTokens,
          cacheCreationTokens: current.cachedWriteTokens,
          outputTokens: current.outputTokens,
          reasoningOutputTokens: current.thoughtTokens,
          lastUsedTokens: delta.totalTokens,
          lastInputTokens: delta.inputTokens,
          lastCachedInputTokens: delta.cachedReadTokens,
          lastCacheCreationTokens: delta.cachedWriteTokens,
          lastOutputTokens: delta.outputTokens,
          lastReasoningOutputTokens: delta.thoughtTokens,
          ...(ctx.pendingCostDeltaUsd !== undefined
            ? { lastCostUsd: ctx.pendingCostDeltaUsd }
            : {}),
          ...(ctx.lastAcpCostUsd !== undefined ? { sessionCostUsd: ctx.lastAcpCostUsd } : {}),
        };
        ctx.pendingCostDeltaUsd = undefined;

        yield* offerRuntimeEvent(
          makeAcpTokenUsageEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            method: "session/prompt",
            usage,
            rawPayload,
          }),
        );
      });

    const skillNamesByCwd = new Map<string, ReadonlySet<string>>();

    /**
     * Skill names eligible for dispatch, cached per workspace. Discovery is a
     * CLI probe, so it only runs once per cwd and failures degrade to "no
     * skills" rather than blocking the prompt.
     */
    const resolveSkillNamesForCwd = (cwd: string, settings: DevinSettings) => {
      const cached = skillNamesByCwd.get(cwd);
      if (cached) {
        return Effect.succeed(cached);
      }
      return discoverDevinSkills(settings, options?.environment ?? process.env, cwd).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
        Effect.provideService(Path.Path, path),
        Effect.map((skills) => {
          const names = new Set(
            skills
              .filter((skill) => skill.enabled && skill.userInvocable !== false)
              .map((skill) => skill.name),
          );
          skillNamesByCwd.set(cwd, names);
          return names;
        }),
        Effect.tapError((cause) =>
          Effect.logDebug("devin skill discovery failed; sending prompt unchanged", {
            stage: cause.stage,
          }),
        ),
        Effect.catch(() => Effect.succeed(new Set<string>() as ReadonlySet<string>)),
      );
    };

    /**
     * Translate known `$skill` mentions into Devin's native `@skills:name`
     * syntax. Discovery runs lazily — only when the prompt carries a candidate
     * token — and a failure leaves the prompt unchanged so the turn still goes
     * out.
     */
    const dispatchDevinSkills = (prompt: string, cwd: string, settings: DevinSettings) =>
      hasCandidateSkillMention(prompt)
        ? resolveSkillNamesForCwd(cwd, settings).pipe(
            Effect.map(
              (skillNames) => planDevinSkillDispatch(prompt, skillNames)?.prompt ?? prompt,
            ),
          )
        : Effect.succeed(prompt);

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<DevinSessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const stopSessionInternal = (ctx: DevinSessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        if (ctx.notificationFiber) {
          yield* Fiber.interrupt(ctx.notificationFiber);
        }
        yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
        sessions.delete(ctx.threadId);
        yield* offerRuntimeEvent({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const startSession: DevinAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }

          const cwd = path.resolve(input.cwd.trim());
          const devinModelSelection =
            input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );
          let ctx!: DevinSessionContext;

          const resumeSessionId = parseDevinResume(input.resumeCursor)?.sessionId;
          const acpNativeLoggers = makeAcpNativeLoggers({
            nativeEventLogger,
            provider: PROVIDER,
            threadId: input.threadId,
          });

          const effectiveDevinSettings = options?.resolveSettings
            ? yield* options.resolveSettings
            : devinSettings;

          const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
          // Devin ignores session/new.mcpServers; T3's tools connect through
          // its private MCP extension with a per-session config directory.
          const connectMcp = mcpSession
            ? yield* prepareDevinMcp(mcpSession).pipe(
                Effect.provideService(Scope.Scope, sessionScope),
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterProcessError({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      detail: "Failed to prepare Devin's T3 Code tool connection.",
                      cause,
                    }),
                ),
              )
            : undefined;
          const acp = yield* makeDevinAcpRuntime({
            devinSettings: effectiveDevinSettings,
            ...(options?.environment || mcpSession?.agentDeviceEnvironment
              ? {
                  environment: McpProviderSession.withAgentDeviceEnvironment(
                    options?.environment ?? process.env,
                    mcpSession,
                  ),
                }
              : {}),
            childProcessSpawner,
            cwd,
            runtimeMode: input.runtimeMode,
            ...(resumeSessionId ? { resumeSessionId } : {}),
            ...(connectMcp ? { additionalDirectories: [connectMcp.directory] } : {}),
            clientInfo: { name: "t3-code", version: "0.0.0" },
            ...acpNativeLoggers,
          }).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          const started = yield* Effect.gen(function* () {
            yield* acp.handleElicitation((params) =>
              mapRequestFailure(
                Effect.gen(function* () {
                  yield* logNative(input.threadId, "session/elicitation", params);
                  if (params.mode !== "form") {
                    return { action: { action: "cancel" as const } };
                  }
                  const questions = extractElicitationQuestions(params);
                  if (questions.length === 0) {
                    return { action: { action: "cancel" as const } };
                  }
                  const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
                  const runtimeRequestId = RuntimeRequestId.make(requestId);
                  const answers = yield* Deferred.make<ProviderUserInputAnswers>();
                  pendingUserInputs.set(requestId, { answers });
                  yield* offerRuntimeEvent({
                    type: "user-input.requested",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId: ctx?.activeTurnId,
                    requestId: runtimeRequestId,
                    payload: { questions },
                    raw: {
                      source: "acp.jsonrpc",
                      method: "session/elicitation",
                      payload: params,
                    },
                  });
                  const resolved = yield* Deferred.await(answers);
                  pendingUserInputs.delete(requestId);
                  yield* offerRuntimeEvent({
                    type: "user-input.resolved",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId: ctx?.activeTurnId,
                    requestId: runtimeRequestId,
                    payload: { answers: resolved },
                  });
                  if (Object.keys(resolved).length === 0) {
                    return { action: { action: "cancel" as const } };
                  }
                  const content: Record<string, string | number | boolean | ReadonlyArray<string>> =
                    {};
                  for (const [key, value] of Object.entries(resolved)) {
                    const coerced = toElicitationContentValue(value);
                    if (coerced !== undefined) {
                      content[key] = coerced;
                    }
                  }
                  return {
                    action: {
                      action: "accept" as const,
                      content,
                    },
                  };
                }),
              ),
            );
            yield* acp.handleRequestPermission((params) =>
              mapRequestFailure(
                Effect.gen(function* () {
                  yield* logNative(input.threadId, "session/request_permission", params);
                  if (input.runtimeMode === "full-access") {
                    const autoApprovedOptionId = selectAutoApprovedPermissionOption(params);
                    if (autoApprovedOptionId !== undefined) {
                      return {
                        outcome: {
                          outcome: "selected" as const,
                          optionId: autoApprovedOptionId,
                        },
                      };
                    }
                  }
                  const { permissionRequest, payload } = sanitizeDevinPermissionRequest(params);
                  const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
                  const runtimeRequestId = RuntimeRequestId.make(requestId);
                  const decision = yield* Deferred.make<ProviderApprovalDecision>();
                  pendingApprovals.set(requestId, {
                    decision,
                    kind: permissionRequest.kind,
                  });
                  yield* offerRuntimeEvent(
                    makeAcpRequestOpenedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: ctx?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      detail:
                        permissionRequest.detail ??
                        encodeJsonStringForDiagnostics(payload)?.slice(0, 2000) ??
                        "[unserializable params]",
                      args: payload,
                      source: "acp.jsonrpc",
                      method: "session/request_permission",
                      rawPayload: payload,
                    }),
                  );
                  const resolved = yield* Deferred.await(decision);
                  pendingApprovals.delete(requestId);
                  yield* offerRuntimeEvent(
                    makeAcpRequestResolvedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: ctx?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      decision: resolved,
                    }),
                  );
                  return {
                    outcome:
                      resolved === "cancel"
                        ? ({ outcome: "cancelled" } as const)
                        : {
                            outcome: "selected" as const,
                            optionId: acpPermissionOutcome(resolved),
                          },
                  };
                }),
              ),
            );
            const result = yield* acp.start();
            if (connectMcp) yield* connectMcp.connect(acp);
            return result;
          }).pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", error),
            ),
          );

          yield* applyRequestedSessionConfiguration({
            runtime: acp,
            runtimeMode: input.runtimeMode,
            interactionMode: undefined,
            modelSelection: devinModelSelection,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
          });

          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            model: devinModelSelection?.model,
            threadId: input.threadId,
            resumeCursor: {
              schemaVersion: DEVIN_RESUME_VERSION,
              sessionId: started.sessionId,
            },
            createdAt: now,
            updatedAt: now,
          };

          ctx = {
            threadId: input.threadId,
            session,
            scope: sessionScope,
            acp,
            notificationFiber: undefined,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            lastPlanFingerprint: undefined,
            activeTurnId: undefined,
            promptsInFlight: 0,
            lastContextWindowUsed: undefined,
            lastContextWindowSize: undefined,
            lastAcpUsage: undefined,
            lastAcpCostUsd: undefined,
            pendingCostDeltaUsd: undefined,
            totalProcessedTokens: 0,
            activeModelUid: yield* readActiveModelUid(acp),
            stopped: false,
          };

          const nf = yield* Stream.runDrain(
            Stream.mapEffect(acp.getEvents(), (event) =>
              Effect.gen(function* () {
                switch (event._tag) {
                  case "EventStreamBarrier":
                    yield* Deferred.succeed(event.acknowledge, undefined);
                    return;
                  case "ModeChanged":
                    return;
                  case "AssistantItemStarted":
                    yield* offerRuntimeEvent(
                      makeAcpAssistantItemEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        itemId: event.itemId,
                        lifecycle: "item.started",
                      }),
                    );
                    return;
                  case "AssistantItemCompleted":
                    yield* offerRuntimeEvent(
                      makeAcpAssistantItemEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        itemId: event.itemId,
                        lifecycle: "item.completed",
                      }),
                    );
                    return;
                  case "PlanUpdated":
                    yield* logNative(ctx.threadId, "session/update", event.rawPayload);
                    yield* emitPlanUpdate(ctx, event.payload, event.rawPayload);
                    return;
                  case "ToolCallUpdated":
                    {
                      const toolCall = sanitizeDevinToolCall(event.toolCall);
                      const rawPayload = sanitizeDevinToolCallRawPayload(
                        event.rawPayload,
                        toolCall,
                      );
                      yield* logNative(ctx.threadId, "session/update", rawPayload);
                      yield* offerRuntimeEvent(
                        makeAcpToolCallEvent({
                          stamp: yield* makeEventStamp(),
                          provider: PROVIDER,
                          threadId: ctx.threadId,
                          turnId: ctx.activeTurnId,
                          toolCall,
                          rawPayload,
                        }),
                      );
                    }
                    return;
                  case "ContentDelta":
                    yield* logNative(ctx.threadId, "session/update", event.rawPayload);
                    yield* offerRuntimeEvent(
                      makeAcpContentDeltaEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        ...(event.itemId ? { itemId: event.itemId } : {}),
                        text: event.text,
                        rawPayload: event.rawPayload,
                      }),
                    );
                    return;
                  case "UsageUpdated":
                    yield* logNative(ctx.threadId, "session/update", event.rawPayload);
                    yield* emitDevinContextUsage(ctx, event.usage, event.rawPayload);
                    return;
                }
              }),
            ),
          ).pipe(
            Effect.catch((cause) =>
              Effect.logError("Failed to process Devin runtime notification.", { cause }),
            ),
            // Fork into the session scope, not the calling fiber — see the
            // equivalent comment in CursorAdapter for why `forkIn` is
            // required here.
            Effect.forkIn(ctx.scope),
          );

          ctx.notificationFiber = nf;
          sessions.set(input.threadId, ctx);
          sessionScopeTransferred = true;

          yield* offerRuntimeEvent({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "Devin ACP session ready" },
          });
          yield* offerRuntimeEvent({
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });

          return session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: DevinAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        // A sendTurn while a prompt is in flight is a steer: the agent folds
        // the new prompt into the ongoing work, so the active turn id is
        // reused instead of opening a new turn.
        const steeringTurnId = ctx.promptsInFlight > 0 ? ctx.activeTurnId : undefined;
        const turnId = steeringTurnId ?? TurnId.make(yield* randomUUIDv4);
        // Count this prompt immediately so a superseded in-flight prompt
        // resolving from here on does not settle the turn; the matching
        // decrement is the `ensuring` below.
        ctx.promptsInFlight += 1;

        return yield* Effect.gen(function* () {
          const turnModelSelection =
            input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
          const model = turnModelSelection?.model ?? ctx.session.model;
          yield* applyRequestedSessionConfiguration({
            runtime: ctx.acp,
            runtimeMode: ctx.session.runtimeMode,
            interactionMode: input.interactionMode,
            modelSelection:
              model === undefined
                ? undefined
                : {
                    model,
                    options: turnModelSelection?.options,
                  },
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
          });
          ctx.activeModelUid = (yield* readActiveModelUid(ctx.acp)) ?? ctx.activeModelUid;
          ctx.activeTurnId = turnId;
          if (steeringTurnId === undefined) {
            ctx.lastPlanFingerprint = undefined;
          }
          ctx.session = {
            ...ctx.session,
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
          };

          if (steeringTurnId === undefined) {
            yield* offerRuntimeEvent({
              type: "turn.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: { model },
            });
          }

          const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
          const rawPrompt = input.input?.trim() ?? "";
          // Known `$skill` mentions become Devin's native `@skills:name`.
          const effectiveDevinSettings = options?.resolveSettings
            ? yield* options.resolveSettings
            : devinSettings;
          const dispatchedPrompt =
            rawPrompt && ctx.session.cwd
              ? yield* dispatchDevinSkills(rawPrompt, ctx.session.cwd, effectiveDevinSettings)
              : rawPrompt;
          if (dispatchedPrompt) {
            promptParts.push({ type: "text", text: dispatchedPrompt });
          }
          if (input.attachments && input.attachments.length > 0) {
            for (const attachment of input.attachments) {
              // Devin ingests images only. Generic files reach the agent
              // through the path line ProviderService puts in the prompt.
              if (attachment.type !== "image") {
                continue;
              }
              const attachmentPath = resolveAttachmentPath({
                attachmentsDir: serverConfig.attachmentsDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/prompt",
                      detail: cause.message,
                      cause,
                    }),
                ),
              );
              promptParts.push({
                type: "image",
                data: Buffer.from(bytes).toString("base64"),
                mimeType: attachment.mimeType,
              });
            }
          }

          if (promptParts.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }

          // ACP has no system-message field; keep runtime context separate from the user's text.
          const result = yield* ctx.acp
            .prompt({
              prompt: [
                ...promptParts,
                {
                  type: "text",
                  text: buildRuntimeInstructions({ harness: "Devin", model }),
                },
              ],
            })
            .pipe(
              Effect.mapError((error) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
              ),
            );

          yield* ctx.acp.drainEvents;
          // ACP prompt responses may carry cumulative token usage.
          yield* emitDevinPromptUsage(ctx, result?.usage, result);

          const turnRecord = ctx.turns.find((turn) => turn.id === turnId);
          if (turnRecord) {
            turnRecord.items.push({ prompt: promptParts, result });
          } else {
            ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
          }
          ctx.session = {
            ...ctx.session,
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
            model,
          };

          // Only the last remaining prompt settles the turn — a steer-
          // superseded prompt resolving (usually cancelled) while another is
          // in flight or pending must leave the merged turn running.
          if (ctx.promptsInFlight === 1) {
            yield* offerRuntimeEvent({
              type: "turn.completed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: {
                state: result.stopReason === "cancelled" ? "cancelled" : "completed",
                stopReason: result.stopReason ?? null,
              },
            });
          }

          return {
            threadId: input.threadId,
            turnId,
            resumeCursor: ctx.session.resumeCursor,
          };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              ctx.promptsInFlight = Math.max(0, ctx.promptsInFlight - 1);
            }),
          ),
        );
      });

    const interruptTurn: DevinAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        yield* Effect.ignore(
          ctx.acp.cancel.pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", error),
            ),
          ),
        );
      });

    const respondToRequest: DevinAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/request_permission",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: DevinAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/elicitation",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.answers, answers);
      });

    const readThread: DevinAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return { threadId, turns: ctx.turns };
      });

    const rollbackThread: DevinAdapterShape["rollbackThread"] = () =>
      Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "Devin does not support conversation rewind. Start a new thread instead.",
        }),
      );

    const stopSession: DevinAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* stopSessionInternal(ctx);
        }),
      );

    const listSessions: DevinAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session })));

    const hasSession: DevinAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const c = sessions.get(threadId);
        return c !== undefined && !c.stopped;
      });

    const stopAll: DevinAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true }).pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to emit Devin session shutdown event.", { cause }),
        ),
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents,
    } satisfies DevinAdapterShape;
  });
}
