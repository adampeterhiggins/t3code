/**
 * CustomAcpAdapter — runs a user-configured ACP agent.
 *
 * The generic counterpart of the Cursor, Devin, and Grok adapters: the same
 * shared ACP session runtime and event mapping, with no agent extensions.
 * Everything the agent can be asked to change (model, config options, mode)
 * is read from its session setup response and applied only when advertised.
 *
 * @module CustomAcpAdapter
 */
import {
  ApprovalRequestId,
  type CustomAcpSettings,
  EventId,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
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
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import {
  acpElicitationResponseFromAnswers,
  extractAcpElicitationQuestions,
  mapAcpToAdapterError,
  selectAcpAutoApprovedPermissionOption,
  selectAcpPermissionOptionId,
} from "../acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import {
  canonicalItemTypeFromAcpToolKind,
  parsePermissionRequest,
} from "../acp/AcpRuntimeModel.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  CUSTOM_ACP_DRIVER_KIND,
  type CustomAcpSessionSetup,
  makeCustomAcpRuntime,
  resolveCustomAcpConfigUpdates,
  resolveCustomAcpModeId,
  resolveCustomAcpSessionModel,
} from "../acp/CustomAcpSupport.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = CUSTOM_ACP_DRIVER_KIND;
const RESUME_VERSION = 1 as const;
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

type CustomAcpAdapterShape = ProviderAdapterShape<ProviderAdapterError>;

interface CustomAcpAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  /** Label for runtime instructions and error details. */
  readonly harness: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly onAvailableCommands?: (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd: string,
  ) => Effect.Effect<void>;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface SessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly setup: CustomAcpSessionSetup;
  readonly acceptsImages: boolean;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  lastPlanFingerprint: string | undefined;
  activeTurnId: TurnId | undefined;
  /** Model applied through `session/set_model`, for agents without a model config option. */
  sessionModelId: string | undefined;
  /** >0 while a turn runs: a new sendTurn steers it, and only the last prompt settles it. */
  promptsInFlight: number;
  stopped: boolean;
}

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

function parseResumeCursor(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const cursor = raw as { readonly schemaVersion?: unknown; readonly sessionId?: unknown };
  if (cursor.schemaVersion !== RESUME_VERSION || typeof cursor.sessionId !== "string") {
    return undefined;
  }
  return cursor.sessionId.trim() || undefined;
}

/** Auto-approval by runtime mode. Everything else goes to the user. */
function autoApprovedOptionId(
  runtimeMode: RuntimeMode,
  params: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  if (runtimeMode === "full-access") return selectAcpAutoApprovedPermissionOption(params);
  if (
    runtimeMode === "auto-accept-edits" &&
    canonicalItemTypeFromAcpToolKind(params.toolCall.kind ?? undefined) === "file_change"
  ) {
    return selectAcpPermissionOptionId(params, "accept");
  }
  return undefined;
}

export function makeCustomAcpAdapter(
  settings: CustomAcpSettings,
  options: CustomAcpAdapterOptions,
) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    const nativeEventLogger = options.nativeEventLogger;
    const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();

    const sessions = new Map<ThreadId, SessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate a runtime identifier.",
            cause,
          }),
      ),
    );
    const makeEventStamp = () =>
      Effect.all({
        eventId: Effect.map(randomUUIDv4, (id) => EventId.make(id)),
        createdAt: nowIso,
      });
    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);
    // Handler failures become transport errors so the runtime reports them on the wire.
    const mapHandlerFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new EffectAcpErrors.AcpTransportError({
              detail: "Failed to handle a custom ACP agent request.",
              cause,
            }),
        ),
      );

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) =>
        Option.match(Option.fromNullishOr(current.get(threadId)), {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        }),
      );
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
      }).pipe(Effect.ignore);

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<SessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      return !ctx || ctx.stopped
        ? Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }))
        : Effect.succeed(ctx);
    };

    const settlePending = (ctx: SessionContext) =>
      Effect.all(
        [
          Effect.forEach(
            ctx.pendingApprovals.values(),
            (pending) => Deferred.succeed(pending.decision, "cancel"),
            { discard: true },
          ),
          Effect.forEach(
            ctx.pendingUserInputs.values(),
            (pending) => Deferred.succeed(pending.answers, {}),
            { discard: true },
          ),
        ],
        { discard: true },
      );

    const stopSessionInternal = (ctx: SessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePending(ctx);
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

    /**
     * Model, option, and mode writes for a turn. Best effort: an agent that
     * rejects one keeps running on its current setting, and permission
     * requests still follow the runtime mode.
     */
    const applySessionConfiguration = (
      ctx: SessionContext,
      input: {
        readonly interactionMode: ProviderInteractionMode | undefined;
        readonly model: string | undefined;
        readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
      },
    ) =>
      Effect.gen(function* () {
        const warn = (method: string) => (cause: EffectAcpErrors.AcpError) =>
          Effect.logWarning("Custom ACP agent rejected a session setting.", {
            method,
            detail: cause.message,
          });
        const updates = resolveCustomAcpConfigUpdates({
          configOptions: yield* ctx.acp.getConfigOptions,
          model: input.model,
          selections: input.selections,
        });
        for (const update of updates) {
          yield* ctx.acp
            .setConfigOption(update.configId, update.value)
            .pipe(Effect.catch(warn("session/set_config_option")));
        }
        const sessionModel = resolveCustomAcpSessionModel({
          configOptions: yield* ctx.acp.getConfigOptions,
          models: ctx.setup.models,
          currentModelId: ctx.sessionModelId ?? ctx.setup.models?.currentModelId,
          model: input.model,
        });
        if (sessionModel !== undefined) {
          yield* ctx.acp.setSessionModel(sessionModel).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                ctx.sessionModelId = sessionModel;
              }),
            ),
            Effect.catch(warn("session/set_model")),
          );
        }
        const modeState = yield* ctx.acp.getModeState;
        const modeId = resolveCustomAcpModeId({
          interactionMode: input.interactionMode,
          runtimeMode: ctx.session.runtimeMode,
          modeState,
        });
        if (modeId !== undefined && modeId !== modeState?.currentModeId) {
          yield* ctx.acp
            .setMode(modeId)
            .pipe(Effect.asVoid, Effect.catch(warn("session/set_mode")));
        }
      });

    const handleEvent = (ctx: SessionContext, event: AcpSessionRuntime.AcpSessionRuntimeEvent) =>
      Effect.gen(function* () {
        const base = {
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurnId,
        } as const;
        switch (event._tag) {
          case "EventStreamBarrier":
            yield* Deferred.succeed(event.acknowledge, undefined);
            return;
          case "AvailableCommandsUpdated":
            yield* (
              options.onAvailableCommands?.(event.availableCommands, ctx.session.cwd ?? "") ??
                Effect.void
            );
            return;
          case "AssistantItemStarted":
          case "AssistantItemCompleted":
            yield* offerRuntimeEvent(
              makeAcpAssistantItemEvent({
                stamp: yield* makeEventStamp(),
                ...base,
                itemId: event.itemId,
                lifecycle:
                  event._tag === "AssistantItemStarted" ? "item.started" : "item.completed",
              }),
            );
            return;
          case "PlanUpdated": {
            yield* logNative(ctx.threadId, "session/update", event.rawPayload);
            const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${encodeJsonStringForDiagnostics(event.payload) ?? ""}`;
            if (ctx.lastPlanFingerprint === fingerprint) return;
            ctx.lastPlanFingerprint = fingerprint;
            yield* offerRuntimeEvent(
              makeAcpPlanUpdatedEvent({
                stamp: yield* makeEventStamp(),
                ...base,
                payload: event.payload,
                source: "acp.jsonrpc",
                method: "session/update",
                rawPayload: event.rawPayload,
              }),
            );
            return;
          }
          case "ToolCallUpdated":
            yield* logNative(ctx.threadId, "session/update", event.rawPayload);
            yield* offerRuntimeEvent(
              makeAcpToolCallEvent({
                stamp: yield* makeEventStamp(),
                ...base,
                toolCall: event.toolCall,
                rawPayload: event.rawPayload,
              }),
            );
            return;
          case "ThoughtDelta":
          case "ContentDelta":
            yield* logNative(ctx.threadId, "session/update", event.rawPayload);
            yield* offerRuntimeEvent(
              makeAcpContentDeltaEvent({
                stamp: yield* makeEventStamp(),
                ...base,
                ...(event._tag === "ThoughtDelta"
                  ? { streamKind: "reasoning_text" as const }
                  : event.itemId
                    ? { itemId: event.itemId }
                    : {}),
                text: event.text,
                rawPayload: event.rawPayload,
              }),
            );
            return;
          default:
            return;
        }
      });

    const startSession: CustomAcpAdapterShape["startSession"] = (input) =>
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
          if (!settings.binaryPath) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "Set the ACP agent executable in Settings → Providers.",
            });
          }

          const cwd = path.resolve(input.cwd.trim());
          const modelSelection =
            input.modelSelection?.instanceId === options.instanceId
              ? input.modelSelection
              : undefined;
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
          let ctx: SessionContext | undefined;
          const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
          const environment = McpProviderSession.withAgentDeviceEnvironment(
            options.environment ?? process.env,
            mcpSession,
          );

          const handlePermission = (params: EffectAcpSchema.RequestPermissionRequest) =>
            Effect.gen(function* () {
              yield* logNative(input.threadId, "session/request_permission", params);
              const autoOptionId = autoApprovedOptionId(input.runtimeMode, params);
              if (autoOptionId !== undefined) {
                return { outcome: { outcome: "selected" as const, optionId: autoOptionId } };
              }
              const permissionRequest = parsePermissionRequest(params);
              const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
              const runtimeRequestId = RuntimeRequestId.make(requestId);
              const decision = yield* Deferred.make<ProviderApprovalDecision>();
              pendingApprovals.set(requestId, { decision });
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
                    encodeJsonStringForDiagnostics(params)?.slice(0, 2000) ??
                    "[unserializable params]",
                  args: params,
                  source: "acp.jsonrpc",
                  method: "session/request_permission",
                  rawPayload: params,
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
              const optionId =
                resolved === "cancel" ? undefined : selectAcpPermissionOptionId(params, resolved);
              return optionId === undefined
                ? { outcome: { outcome: "cancelled" as const } }
                : { outcome: { outcome: "selected" as const, optionId } };
            });

          const handleElicitation = (params: EffectAcpSchema.ElicitationRequest) =>
            Effect.gen(function* () {
              yield* logNative(input.threadId, "session/elicitation", params);
              if (params.mode !== "form") return { action: { action: "cancel" as const } };
              const questions = extractAcpElicitationQuestions(params);
              if (questions.length === 0) return { action: { action: "cancel" as const } };
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
                raw: { source: "acp.jsonrpc", method: "session/elicitation", payload: params },
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
              return acpElicitationResponseFromAnswers(resolved);
            });

          // One ACP process per attempt, owned by its own scope until the
          // session takes it over.
          const openRuntime = (resumeSessionId: string | undefined) =>
            Effect.gen(function* () {
              const scope = yield* Scope.make("sequential");
              return yield* Effect.gen(function* () {
                const acp = yield* makeCustomAcpRuntime({
                  settings,
                  environment,
                  childProcessSpawner,
                  cwd,
                  ...(resumeSessionId ? { resumeSessionId } : {}),
                  clientInfo: { name: "t3-code", version: "0.0.0" },
                  // T3's MCP endpoint is HTTP; only agents that advertise HTTP MCP get it.
                  ...(mcpSession
                    ? {
                        mcpServers: (initialized: EffectAcpSchema.InitializeResponse) =>
                          initialized.agentCapabilities?.mcpCapabilities?.http
                            ? [
                                {
                                  type: "http" as const,
                                  name: "t3-code",
                                  url: mcpSession.endpoint,
                                  headers: [
                                    {
                                      name: "Authorization",
                                      value: mcpSession.authorizationHeader,
                                    },
                                  ],
                                },
                              ]
                            : [],
                      }
                    : {}),
                  ...makeAcpNativeLoggers({
                    nativeEventLogger,
                    provider: PROVIDER,
                    threadId: input.threadId,
                  }),
                }).pipe(Effect.provideService(Scope.Scope, scope));
                yield* acp.handleRequestPermission((params) =>
                  mapHandlerFailure(handlePermission(params)),
                );
                yield* acp.handleElicitation((params) =>
                  mapHandlerFailure(handleElicitation(params)),
                );
                const started = yield* acp.start();
                return { acp, scope, started };
              }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
            }).pipe(Effect.provideService(Crypto.Crypto, crypto));

          // Agents without `session/load`, or that lost the session, start fresh.
          const resumeSessionId = parseResumeCursor(input.resumeCursor);
          const opened = yield* (
            resumeSessionId
              ? openRuntime(resumeSessionId).pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Custom ACP agent could not resume; starting fresh.", {
                      detail: cause.message,
                    }).pipe(Effect.andThen(openRuntime(undefined))),
                  ),
                )
              : openRuntime(undefined)
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: `${options.harness} did not start an ACP session: ${cause.message}`,
                  cause,
                }),
            ),
          );

          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            model: modelSelection?.model,
            threadId: input.threadId,
            resumeCursor: { schemaVersion: RESUME_VERSION, sessionId: opened.started.sessionId },
            createdAt: now,
            updatedAt: now,
          };
          const context: SessionContext = {
            threadId: input.threadId,
            session,
            scope: opened.scope,
            acp: opened.acp,
            setup: opened.started.sessionSetupResult,
            acceptsImages:
              opened.started.initializeResult.agentCapabilities?.promptCapabilities?.image === true,
            notificationFiber: undefined,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            lastPlanFingerprint: undefined,
            activeTurnId: undefined,
            sessionModelId: undefined,
            promptsInFlight: 0,
            stopped: false,
          };
          ctx = context;

          yield* applySessionConfiguration(context, {
            interactionMode: undefined,
            model: modelSelection?.model,
            selections: modelSelection?.options,
          });

          context.notificationFiber = yield* Stream.runDrain(
            Stream.mapEffect(opened.acp.getEvents(), (event) => handleEvent(context, event)),
          ).pipe(
            Effect.catch((cause) =>
              Effect.logError("Failed to process a custom ACP notification.", { cause }),
            ),
            // The session scope owns the consumer; forking into the caller would
            // interrupt it as soon as startSession returns.
            Effect.forkIn(context.scope),
          );
          sessions.set(input.threadId, context);

          yield* offerRuntimeEvent({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: opened.started.initializeResult },
          });
          yield* offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: `${options.harness} ACP session ready` },
          });
          yield* offerRuntimeEvent({
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: opened.started.sessionId },
          });
          return session;
        }),
      );

    const buildPrompt = (
      ctx: SessionContext,
      text: string,
      attachments: NonNullable<ProviderSendTurnInput["attachments"]>,
    ) =>
      Effect.gen(function* () {
        const parts: Array<EffectAcpSchema.ContentBlock> = [];
        if (text) parts.push({ type: "text", text });
        // Agents that do not take images still see the attachment path line
        // ProviderService adds to the prompt.
        for (const attachment of ctx.acceptsImages ? attachments : []) {
          if (attachment.type !== "image") continue;
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
          parts.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          });
        }
        return parts;
      });

    const sendTurn: CustomAcpAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const steeringTurnId = ctx.promptsInFlight > 0 ? ctx.activeTurnId : undefined;
        const turnId = steeringTurnId ?? TurnId.make(yield* randomUUIDv4);
        ctx.promptsInFlight += 1;

        return yield* Effect.gen(function* () {
          const turnModelSelection =
            input.modelSelection?.instanceId === options.instanceId
              ? input.modelSelection
              : undefined;
          const model = turnModelSelection?.model ?? ctx.session.model;
          yield* applySessionConfiguration(ctx, {
            interactionMode: input.interactionMode,
            model,
            selections: turnModelSelection?.options,
          });
          ctx.activeTurnId = turnId;
          if (steeringTurnId === undefined) {
            ctx.lastPlanFingerprint = undefined;
            yield* offerRuntimeEvent({
              type: "turn.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: model ? { model } : {},
            });
          }
          ctx.session = { ...ctx.session, activeTurnId: turnId, updatedAt: yield* nowIso };

          const rawPrompt = input.input?.trim() ?? "";
          const promptParts = yield* buildPrompt(ctx, rawPrompt, input.attachments ?? []);
          if (promptParts.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }

          // Slash commands must reach the agent verbatim.
          const result = yield* ctx.acp
            .prompt({
              prompt: /^\/[^\s/]+(?:\s|$)/.test(rawPrompt)
                ? promptParts
                : [
                    ...promptParts,
                    {
                      type: "text",
                      text: buildRuntimeInstructions({ harness: options.harness, model }),
                    },
                  ],
            })
            .pipe(
              Effect.mapError((error) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
              ),
            );
          yield* ctx.acp.drainEvents;

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
            ...(model ? { model } : {}),
          };
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
          return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              ctx.promptsInFlight = Math.max(0, ctx.promptsInFlight - 1);
            }),
          ),
        );
      });

    const interruptTurn: CustomAcpAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* settlePending(ctx);
        yield* Effect.ignore(ctx.acp.cancel);
      });

    const respondToRequest: CustomAcpAdapterShape["respondToRequest"] = (
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

    const respondToUserInput: CustomAcpAdapterShape["respondToUserInput"] = (
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

    const readThread: CustomAcpAdapterShape["readThread"] = (threadId) =>
      Effect.map(requireSession(threadId), (ctx) => ({ threadId, turns: ctx.turns }));

    const rollbackThread: CustomAcpAdapterShape["rollbackThread"] = (threadId) =>
      Effect.flatMap(requireSession(threadId), () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "thread/rollback",
            detail: "ACP sessions do not support provider-side rollback.",
          }),
        ),
      );

    const stopSession: CustomAcpAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(threadId, Effect.flatMap(requireSession(threadId), stopSessionInternal));

    const stopAll: CustomAcpAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to emit custom ACP session shutdown events.", { cause }),
        ),
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
      ),
    );

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
      listSessions: () =>
        Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session }))),
      hasSession: (threadId) =>
        Effect.sync(() => {
          const c = sessions.get(threadId);
          return c !== undefined && !c.stopped;
        }),
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies CustomAcpAdapterShape;
  });
}
