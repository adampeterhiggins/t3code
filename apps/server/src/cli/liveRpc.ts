import {
  AuthStandardClientScopes,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { Flag, GlobalFlag } from "effect/cli";
import { RpcClient, RpcSerialization } from "effect/rpc";
import * as Socket from "effect/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const makeClient = RpcClient.make(WsRpcGroup);
export type LiveRpcClient =
  typeof makeClient extends Effect.Effect<infer Client, any, any> ? Client : never;

export class LiveServerNotRunningError extends Schema.TaggedError<LiveServerNotRunningError>()(
  "LiveServerNotRunningError",
  { baseDir: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `No running T3 Code server uses ${this.baseDir}. Start T3 Code, then retry.`;
  }
}

export class LiveRpcFailedError extends Schema.TaggedError<LiveRpcFailedError>()(
  "LiveRpcFailedError",
  { detail: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

/** For a bad flag combination or an argument the server would reject anyway. */
export class LiveUsageError extends Schema.TaggedError<LiveUsageError>()("LiveUsageError", {
  detail: Schema.String,
}) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

const isReportable = Schema.is(
  Schema.Union([LiveServerNotRunningError, LiveRpcFailedError, LiveUsageError]),
);

const describeFailure = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
    const tag = (error as { readonly _tag?: unknown })._tag;
    if (typeof tag === "string") return tag;
  }
  return String(error);
};

/**
 * Wraps one RPC so a server-side failure (typed or transport) prints as one
 * line instead of a logged stack trace.
 */
export const rpc = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) => new LiveRpcFailedError({ detail: describeFailure(error) })),
  );

const SOCKET_OPEN_TIMEOUT = Duration.seconds(10);
const SESSION_TTL = Duration.minutes(30);

/**
 * Signs in to the running server as a short-lived standard client, the same
 * authority `t3 pair` hands a browser, opens one `/ws` RPC socket, and revokes
 * the session when the command ends. Settings, integrations, and other
 * features that only clients reach go through this; agent-shaped thread work
 * goes through MCP in `thread.ts`.
 */
export const withLiveRpc = Effect.fn("cli.withLiveRpc")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  label: string,
  run: (client: LiveRpcClient) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* Effect.gen(function* () {
    const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) {
      return yield* new LiveServerNotRunningError({ baseDir: config.baseDir });
    }
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const issued = yield* Effect.acquireRelease(
      environmentAuth.issueSession({
        scopes: AuthStandardClientScopes,
        label,
        ttl: SESSION_TTL,
      }),
      (session) =>
        environmentAuth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
    );
    const ticket = yield* environmentAuth.issueWebSocketTicket({ sessionId: issued.sessionId });
    const socketUrl = new URL("/ws", runtimeState.value.origin);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("wsTicket", ticket.ticket);
    socketUrl.searchParams.set(
      ORCHESTRATION_PROTOCOL_QUERY_PARAM,
      String(ORCHESTRATION_PROTOCOL_VERSION),
    );
    const protocol = yield* Layer.build(
      Layer.effect(
        RpcClient.Protocol,
        RpcClient.makeProtocolSocket({
          retryTransientErrors: false,
          retryPolicy: Schedule.recurs(0),
        }),
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            Socket.layerWebSocket(socketUrl.href, { openTimeout: SOCKET_OPEN_TIMEOUT }).pipe(
              Layer.provide(Socket.layerWebSocketConstructorGlobal),
            ),
            RpcSerialization.layerJson,
          ),
        ),
      ),
    );
    const client = yield* makeClient.pipe(Effect.provide(protocol));
    return yield* run(client);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
    Effect.tapError((error) => (isReportable(error) ? Console.error(error.message) : Effect.void)),
  );
});

export const liveLocationFlags = projectLocationFlags;

export const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON instead of text."),
  Flag.withDefault(false),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const printJson = (value: unknown) => Console.log(encodeJson(value));
