import {
  type DevinReviewAccount,
  type DevinReviewConnectInput,
  type DevinReviewConnectionState,
  DevinReviewError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { makeDevinAcpRuntime } from "../provider/acp/DevinAcpSupport.ts";
import {
  DEVIN_UNREACHABLE,
  type DevinCredentials,
  devinCliToken,
  devinPrReviewRequest,
  devinSelf,
} from "./devinReviewApi.ts";

const DEVIN_CONNECTION_SECRET = "devin-review-connection";
const KEY_REVOKED = "Devin rejected the service key. Paste a new one to reconnect.";
const LOGIN_REVOKED = "Your Devin login expired or was signed out. Sign in with Devin again.";
/** A service key has no identity endpoint, so connecting looks up a review of a public PR. */
const PROBE_PULL_REQUEST = { repository: "octocat/Hello-World", number: 1 };

/** A Devin login keeps only who it is; the token is read from the CLI's login on each call. */
const PersistedConnection = Schema.Union([
  Schema.Struct({
    method: Schema.Literal("devin-login"),
    orgId: Schema.String,
    userName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    method: Schema.Literal("service-key"),
    apiKey: Schema.String,
    orgId: Schema.String,
  }),
]);
type PersistedConnection = typeof PersistedConnection.Type;
const PersistedConnectionJson = Schema.fromJsonString(PersistedConnection);
const decodePersisted = Schema.decodeUnknownEffect(PersistedConnectionJson);
const encodePersisted = Schema.encodeEffect(PersistedConnectionJson);

const accountOf = (connection: PersistedConnection): DevinReviewAccount => ({
  method: connection.method,
  orgId: connection.orgId,
  userName: connection.method === "devin-login" ? connection.userName : null,
});
const disconnectedState: DevinReviewConnectionState = {
  phase: "disconnected",
  account: null,
  signInUrl: null,
  message: null,
};
const connectedState = (connection: PersistedConnection): DevinReviewConnectionState => ({
  phase: "connected",
  account: accountOf(connection),
  signInUrl: null,
  message: null,
});
const failedState = (message: string): DevinReviewConnectionState => ({
  phase: "failed",
  account: null,
  signInUrl: null,
  message,
});
const isDevinReviewError = Schema.is(DevinReviewError);
const loginError = (detail: string) => new DevinReviewError({ reason: "api", detail });

/** Why Devin's browser sign-in failed, in words that say what to do about it. */
function devinSignInFailure(cause: { readonly _tag: string; readonly message: string }) {
  return cause._tag === "AcpSpawnError"
    ? "The Devin CLI isn't installed on this environment. Install it, or use a service key."
    : `Devin sign-in did not complete: ${cause.message}`;
}

export class DevinReviewAuth extends Context.Service<
  DevinReviewAuth,
  {
    readonly state: Stream.Stream<DevinReviewConnectionState>;
    /** Checks a pasted service key with Devin, then keeps it for every client. */
    readonly connect: (
      input: DevinReviewConnectInput,
    ) => Effect.Effect<DevinReviewConnectionState, DevinReviewError>;
    /**
     * Uses the `devin` CLI's login on this environment, running Devin's browser sign-in first
     * when there is none. Returns once the sign-in is under way.
     */
    readonly signIn: Effect.Effect<DevinReviewConnectionState, DevinReviewError>;
    readonly cancelSignIn: Effect.Effect<DevinReviewConnectionState, DevinReviewError>;
    readonly disconnect: Effect.Effect<DevinReviewConnectionState, DevinReviewError>;
    /** The token and organization to call Devin with, or none while not connected. */
    readonly credentials: Effect.Effect<Option.Option<DevinCredentials>, DevinReviewError>;
    /** Forgets the connection after Devin rejects its token. */
    readonly markRevoked: Effect.Effect<void>;
  }
>()("t3/devinReview/DevinReviewAuth") {}

/** @public */
export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const secureRandom = yield* SecureRandom.SecureRandom;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);
  const lock = yield* Semaphore.make(1);
  const signInHandle = yield* FiberHandle.make<void, never>();
  const environment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;

  // Where `devin auth login` keeps its login, the same file the Devin provider's default
  // instance signs in to.
  const cliCredentialsPath = path.join(
    environment.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "devin",
    "credentials.toml",
  );
  const readCliToken = fileSystem.readFileString(cliCredentialsPath).pipe(
    Effect.map(devinCliToken),
    Effect.orElseSucceed(() => null),
  );

  const readConnection = secrets
    .get(DEVIN_CONNECTION_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isNone(bytes)
          ? Effect.succeedNone
          : decodePersisted(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
      ),
    );
  const removeConnection = secrets.remove(DEVIN_CONNECTION_SECRET).pipe(Effect.ignore);
  const saveConnection = (connection: PersistedConnection) =>
    encodePersisted(connection).pipe(
      Effect.flatMap((encoded) =>
        secrets.set(DEVIN_CONNECTION_SECRET, new TextEncoder().encode(encoded)),
      ),
      Effect.mapError(() => loginError("Could not save the Devin connection.")),
    );

  const initial = yield* readConnection.pipe(
    Effect.map((connection) =>
      Option.isSome(connection) ? connectedState(connection.value) : disconnectedState,
    ),
    Effect.orElseSucceed(() => disconnectedState),
  );
  const state = yield* SubscriptionRef.make<DevinReviewConnectionState>(initial);

  /** Connects with the CLI's login when it has one Devin accepts; false when it has none. */
  const connectWithCliLogin = Effect.gen(function* () {
    const token = yield* readCliToken;
    if (token === null) return false;
    const self = yield* devinSelf(token).pipe(Effect.provide(services));
    if (self === null) return false;
    const connection: PersistedConnection = { method: "devin-login", ...self };
    yield* saveConnection(connection);
    yield* SubscriptionRef.set(state, connectedState(connection));
    return true;
  });

  const browserSignIn = Effect.scoped(
    Effect.gen(function* () {
      let output = "";
      const runtime = yield* makeDevinAcpRuntime({
        devinSettings: null,
        environment,
        childProcessSpawner: spawner,
        cwd: home,
        clientInfo: { name: "t3-code", version: "0.0.0" },
        onStderr: (text) => {
          output = (output + text).slice(-4096);
          const url = /https:\/\/[^\s"'\\]+/u.exec(output)?.[0];
          return url === undefined
            ? Effect.void
            : SubscriptionRef.update(state, (current) =>
                current.phase === "waiting" && current.signInUrl === null
                  ? { ...current, signInUrl: url }
                  : current,
              );
        },
      });
      if (runtime.authenticate === undefined) {
        return yield* loginError("This version of the Devin CLI cannot sign in for T3 Code.");
      }
      yield* runtime.authenticate("devin-browser");
    }),
  ).pipe(
    Effect.provideService(SecureRandom.SecureRandom, secureRandom),
    Effect.mapError((cause) =>
      isDevinReviewError(cause) ? cause : loginError(devinSignInFailure(cause)),
    ),
    Effect.andThen(connectWithCliLogin),
    Effect.flatMap((connected) =>
      connected ? Effect.void : loginError("Devin sign-in finished without a usable login."),
    ),
    Effect.catch((error: DevinReviewError) =>
      SubscriptionRef.set(state, failedState(error.detail)),
    ),
  );

  const signIn = lock
    .withPermits(1)(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current.phase === "waiting") return current;
        if (yield* connectWithCliLogin) return yield* SubscriptionRef.get(state);
        const waiting: DevinReviewConnectionState = {
          phase: "waiting",
          account: null,
          signInUrl: null,
          message: null,
        };
        yield* SubscriptionRef.set(state, waiting);
        yield* FiberHandle.run(signInHandle, browserSignIn);
        return waiting;
      }),
    )
    .pipe(Effect.withSpan("devin_review.auth.sign_in"));

  const cancelSignIn = lock
    .withPermits(1)(
      Effect.gen(function* () {
        yield* FiberHandle.clear(signInHandle);
        const current = yield* SubscriptionRef.get(state);
        if (current.phase !== "waiting") return current;
        yield* SubscriptionRef.set(state, disconnectedState);
        return disconnectedState;
      }),
    )
    .pipe(Effect.withSpan("devin_review.auth.cancel_sign_in"));

  const connect = Effect.fn("devin_review.auth.connect")(function* (
    input: DevinReviewConnectInput,
  ) {
    const connection: PersistedConnection = {
      method: "service-key",
      apiKey: input.apiKey.replace(/^Bearer\s+/i, ""),
      orgId: input.orgId,
    };
    yield* devinPrReviewRequest(connection, "GET", PROBE_PULL_REQUEST).pipe(
      Effect.provide(services),
      Effect.catchIf(
        // Devin could not find or review the probe pull request, which still proves the key.
        (error) =>
          error.reason === "not-found" ||
          (error.reason === "api" && error.detail !== DEVIN_UNREACHABLE),
        () => Effect.void,
      ),
      Effect.mapError((error) =>
        error.reason === "revoked" || error.reason === "forbidden"
          ? new DevinReviewError({
              reason: "forbidden",
              detail: `Devin refused that key for organization ${connection.orgId}. Use a service user key (cog_…) from that organization with the ViewReview permission, and UseReviewManual to start reviews.`,
            })
          : error,
      ),
    );
    yield* FiberHandle.clear(signInHandle);
    yield* saveConnection(connection);
    const connected = connectedState(connection);
    yield* SubscriptionRef.set(state, connected);
    return connected;
  }, lock.withPermits(1));

  const disconnect = lock
    .withPermits(1)(
      Effect.gen(function* () {
        yield* FiberHandle.clear(signInHandle);
        yield* removeConnection;
        yield* SubscriptionRef.set(state, disconnectedState);
        return disconnectedState;
      }),
    )
    .pipe(Effect.withSpan("devin_review.auth.disconnect"));

  // A Devin login belongs to the CLI, so only T3's record of it is dropped.
  const markRevoked = lock.withPermits(1)(
    Effect.gen(function* () {
      const connection = yield* readConnection.pipe(Effect.orElseSucceed(() => Option.none()));
      yield* removeConnection;
      yield* SubscriptionRef.set(
        state,
        failedState(
          Option.isSome(connection) && connection.value.method === "devin-login"
            ? LOGIN_REVOKED
            : KEY_REVOKED,
        ),
      );
    }),
  );

  const credentials = Effect.gen(function* () {
    const connection = yield* readConnection.pipe(
      Effect.mapError(() => loginError("Could not read the Devin connection.")),
    );
    if (Option.isNone(connection)) return Option.none<DevinCredentials>();
    if (connection.value.method === "service-key") return Option.some(connection.value);
    const token = yield* readCliToken;
    if (token === null) {
      yield* markRevoked;
      return Option.none<DevinCredentials>();
    }
    return Option.some<DevinCredentials>({
      method: "devin-login",
      apiKey: token,
      orgId: connection.value.orgId,
    });
  });

  return DevinReviewAuth.of({
    state: SubscriptionRef.changes(state),
    connect,
    signIn,
    cancelSignIn,
    disconnect,
    credentials,
    markRevoked,
  });
});

export const layer = Layer.effect(DevinReviewAuth, make);
