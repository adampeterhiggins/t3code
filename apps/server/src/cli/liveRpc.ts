import {
  AuthStandardClientScopes,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_V2_WS_METHODS,
  WsRpcGroup,
  WS_METHODS,
  type OrchestrationV2ShellSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Flag, GlobalFlag } from "effect/cli";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/rpc";
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

const isRpcClientError = Schema.is(RpcClientError.RpcClientError);

const describeFailure = (error: unknown): string => {
  // A dropped socket surfaces as a bare SocketCloseError; dev servers and
  // updates restart the server mid-command, and a retry is the fix.
  if (isRpcClientError(error)) {
    return "Lost the connection to the T3 Code server, which may have restarted. Run the command again.";
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
    const tag = (error as { readonly _tag?: unknown })._tag;
    if (typeof tag === "string") return tag;
  }
  return String(error);
};

/** Prints a CLI error as one line; for checks that fail before `withLiveRpc` runs. */
export const reportLiveErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) => (isReportable(error) ? Console.error(error.message) : Effect.void)),
  );

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

/** Opens an owner-authorized client session and revokes it when this CLI command ends. */
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
    reportLiveErrors,
  );
});

export const liveLocationFlags = projectLocationFlags;

export const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON instead of text."),
  Flag.withDefault(false),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const printJson = (value: unknown) => Console.log(encodeJson(value));

/** The server's current projects and threads, read from the first shell stream frame. */
export const loadLiveShell = Effect.fn("cli.loadLiveShell")(function* (client: LiveRpcClient) {
  const first = yield* rpc(
    client[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({}).pipe(
      Stream.filter((item) => item.kind === "snapshot"),
      Stream.runHead,
    ),
  );
  if (Option.isNone(first) || first.value.kind !== "snapshot") {
    return yield* new LiveRpcFailedError({ detail: "The server sent no project snapshot." });
  }
  return first.value.snapshot;
});

export type LiveProject = OrchestrationV2ShellSnapshot["projects"][number];

/** A project id, or a path inside a project's folder (deepest project wins). */
export const resolveLiveProject = Effect.fn("cli.resolveLiveProject")(function* (
  projects: ReadonlyArray<LiveProject>,
  identifier: string,
) {
  const byId = projects.find((project) => project.id === identifier);
  if (byId !== undefined) return byId;

  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  // Stored roots keep the path the project was added with, which may pass
  // through a symlink (macOS /tmp), so both sides compare as real paths.
  const realPath = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => value));
  const target = yield* realPath(path.resolve(yield* HostProcess.WorkingDirectory, identifier));
  const roots = yield* Effect.forEach(projects, (project) =>
    Effect.map(realPath(project.workspaceRoot), (root) => ({ project, root })),
  );
  const containing = roots
    .filter(({ root }) => {
      const relative = path.relative(root, target);
      return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    })
    .toSorted((left, right) => right.root.length - left.root.length)[0];
  if (containing === undefined) {
    return yield* new LiveUsageError({
      detail: `No T3 Code project matches '${identifier}'. Pass a project id or a path inside a project.`,
    });
  }
  return containing.project;
});

/**
 * An exact id, else the one id containing the text, so a pasted prefix or
 * fragment of a long id works as it does in the web pickers.
 */
export const matchId = <T>(
  items: ReadonlyArray<T>,
  idOf: (item: T) => string,
  needle: string,
):
  | { readonly type: "found"; readonly item: T }
  | { readonly type: "none" }
  | { readonly type: "ambiguous"; readonly ids: ReadonlyArray<string> } => {
  const query = needle.trim().toLowerCase();
  const exact = items.find((item) => idOf(item).toLowerCase() === query);
  if (exact !== undefined) return { type: "found", item: exact };
  if (query.length === 0) return { type: "none" };
  const partial = items.filter((item) => idOf(item).toLowerCase().includes(query));
  const [only] = partial;
  if (partial.length === 1 && only !== undefined) return { type: "found", item: only };
  return partial.length === 0 ? { type: "none" } : { type: "ambiguous", ids: partial.map(idOf) };
};

// Swedish formatting is ISO-like in the local zone: 2026-10-21 09:00.
const LOCAL_MINUTE_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatLocalMinute = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? LOCAL_MINUTE_FORMAT.format(at) : iso;
};

export const loadLiveSettings = Effect.fn("cli.loadLiveSettings")(function* (
  client: LiveRpcClient,
) {
  const first = yield* rpc(
    client[WS_METHODS.subscribeServerConfig]({ workspaceSnapshotsOnDemand: true }).pipe(
      Stream.filter((event) => event.type === "snapshot"),
      Stream.runHead,
    ),
  );
  if (Option.isNone(first) || first.value.type !== "snapshot") {
    return yield* new LiveRpcFailedError({ detail: "The server sent no settings snapshot." });
  }
  return first.value.config.settings;
});
