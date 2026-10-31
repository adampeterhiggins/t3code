// @effect-diagnostics globalTimers:off -- The Node socket client owns its response deadline and clears it on every completion path.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect stat follows symlinks; IPC ownership validation requires lstat.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import {
  DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
  DesktopAppActivationErrorCode,
  DesktopAppActivationResponse,
  DesktopAppNetworkAccessResponse,
  type DesktopAppActivationPlatform,
  type DesktopAppActivationRequest,
  type DesktopAppControlRequest,
  type DesktopAppNetworkAccessRequest,
  type DesktopServerExposureMode,
} from "@t3tools/contracts";
import {
  resolveDesktopAppControlAddress,
  type DesktopAppControlAddress,
} from "@t3tools/shared/desktopAppControl";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import { expandHomePath, resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";
import { jsonFlag, printJson } from "./liveRpc.ts";

const CLI_RESPONSE_TIMEOUT_MS = 17_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const isDesktopAppActivationResponse = Schema.is(DesktopAppActivationResponse);
const isDesktopAppNetworkAccessResponse = Schema.is(DesktopAppNetworkAccessResponse);

export class DesktopAppSshUnsupportedError extends Schema.TaggedError<DesktopAppSshUnsupportedError>()(
  "DesktopAppSshUnsupportedError",
  {},
) {
  override get message(): string {
    return "`t3 app` only controls a desktop app on the same machine. It cannot run over SSH.";
  }
}

export class DesktopAppPlatformUnsupportedError extends Schema.TaggedError<DesktopAppPlatformUnsupportedError>()(
  "DesktopAppPlatformUnsupportedError",
  { platform: Schema.String },
) {
  override get message(): string {
    return `\`t3 app\` is not supported on ${this.platform}.`;
  }
}

export class DesktopAppUnreachableError extends Schema.TaggedError<DesktopAppUnreachableError>()(
  "DesktopAppUnreachableError",
  {
    candidateAddresses: Schema.Array(Schema.String),
    requestId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not reach the T3 Code desktop app. Start or update the desktop app on this machine, then run `t3 app` again. A running T3 Code server is not enough.";
  }
}

export class DesktopAppRequestFailedError extends Schema.TaggedError<DesktopAppRequestFailedError>()(
  "DesktopAppRequestFailedError",
  {
    code: DesktopAppActivationErrorCode,
    requestId: Schema.String,
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `T3 Code could not open ${this.workspaceRoot} (${this.code}).`;
  }
}

export class DesktopAppNetworkAccessFailedError extends Schema.TaggedError<DesktopAppNetworkAccessFailedError>()(
  "DesktopAppNetworkAccessFailedError",
  {
    code: DesktopAppActivationErrorCode,
    requestId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    switch (this.code) {
      // Desktop builds from before this request reject it as invalid.
      case "invalid-request":
        return "This T3 Code desktop app cannot change network access from the command line. Update the desktop app, or use Settings → Connections → Network access.";
      case "network-address-unavailable":
        return "T3 Code found no network address other devices can reach. Connect this machine to a network, then try again.";
      default:
        return `T3 Code could not change network access (${this.code}).`;
    }
  }
}

function isDesktopPlatform(platform: NodeJS.Platform): platform is DesktopAppActivationPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

async function sendDesktopAppControlRequest<
  Response extends { readonly requestId: string },
>(input: {
  readonly address: DesktopAppControlAddress;
  readonly fallbackAddress?: DesktopAppControlAddress;
  readonly userId: number | undefined;
  readonly request: DesktopAppControlRequest;
  readonly isResponse: (value: unknown) => value is Response;
  readonly timeoutMs?: number;
}): Promise<Response> {
  if (input.address.directory !== null) {
    const stat = await NodeFSP.lstat(input.address.directory);
    if (
      !stat.isDirectory() ||
      input.userId === undefined ||
      stat.uid !== input.userId ||
      (stat.mode & 0o077) !== 0
    ) {
      throw new Error("The desktop app socket directory is not private or owned by this user.");
    }
  }
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection(input.address.address);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    let connected = false;

    const finish = (
      result:
        | { readonly type: "success"; readonly response: Response }
        | { readonly type: "failure"; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (result.type === "success") resolve(result.response);
      else reject(result.error);
    };

    const timeout = setTimeout(() => {
      finish({
        type: "failure",
        error: new Error("The desktop app did not respond in time."),
      });
    }, input.timeoutMs ?? CLI_RESPONSE_TIMEOUT_MS);

    socket.once("connect", () => {
      connected = true;
      socket.write(`${JSON.stringify(input.request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        finish({ type: "failure", error: new Error("The desktop app response is too large.") });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.slice(0, newline));
      } catch {
        finish({
          type: "failure",
          error: new Error("The desktop app response is not valid JSON."),
        });
        return;
      }
      if (!input.isResponse(parsed)) {
        finish({ type: "failure", error: new Error("The desktop app response is invalid.") });
        return;
      }
      if (parsed.requestId !== input.request.requestId) {
        finish({
          type: "failure",
          error: new Error("The desktop app response did not match this request."),
        });
        return;
      }
      finish({ type: "success", response: parsed });
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (
        !settled &&
        !connected &&
        input.fallbackAddress !== undefined &&
        (error.code === "ENOENT" || error.code === "ECONNREFUSED")
      ) {
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(
          sendDesktopAppControlRequest({
            address: input.fallbackAddress,
            userId: input.userId,
            request: input.request,
            isResponse: input.isResponse,
            ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          }),
        );
        return;
      }
      finish({ type: "failure", error });
    });
    socket.once("end", () => {
      finish({ type: "failure", error: new Error("The desktop app closed the connection.") });
    });
  });
}

const appEnvironment = Config.all({
  t3Home: Config.String("T3CODE_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  sshConnection: Config.String("SSH_CONNECTION").pipe(Config.option),
  sshTty: Config.String("SSH_TTY").pipe(Config.option),
});

/**
 * Resolves the running desktop app's control socket and sends one request.
 * With no explicit home, a dev desktop is the fallback when the installed one
 * is not running.
 */
const sendToDesktopApp = Effect.fn("cli.app.send")(function* <
  Response extends { readonly requestId: string },
>(input: {
  readonly baseDir: Option.Option<string>;
  readonly makeRequest: (
    requestId: string,
    platform: DesktopAppActivationPlatform,
  ) => DesktopAppControlRequest;
  readonly isResponse: (value: unknown) => value is Response;
}) {
  const environment = yield* appEnvironment;
  const hostPlatform = yield* HostProcess.Platform;
  if (Option.isSome(environment.sshConnection) || Option.isSome(environment.sshTty)) {
    return yield* new DesktopAppSshUnsupportedError({});
  }
  if (!isDesktopPlatform(hostPlatform)) {
    return yield* new DesktopAppPlatformUnsupportedError({ platform: hostPlatform });
  }

  const path = yield* Path.Path;
  const configuredBaseDir = Option.getOrUndefined(input.baseDir) ?? environment.t3Home;
  const baseDir = yield* resolveBaseDir(configuredBaseDir);
  const allowDevFallback = Option.isNone(input.baseDir) && !environment.t3Home?.trim();
  const userId = yield* HostProcess.UserId;
  const resolveAddress = (stateSubdirectory: "userdata" | "dev") =>
    resolveDesktopAppControlAddress({
      stateDir: path.join(baseDir, stateSubdirectory),
      platform: hostPlatform,
      tempDir: NodeOS.tmpdir(),
      userId,
      joinPath: path.join,
    });
  const crypto = yield* Crypto.Crypto;
  const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
  const request = input.makeRequest(requestId, hostPlatform);
  const address = resolveAddress("userdata");
  const fallbackAddress = allowDevFallback ? resolveAddress("dev") : undefined;

  return yield* Effect.tryPromise({
    try: () =>
      sendDesktopAppControlRequest({
        address,
        userId,
        ...(fallbackAddress === undefined ? {} : { fallbackAddress }),
        request,
        isResponse: input.isResponse,
      }),
    catch: (cause) =>
      new DesktopAppUnreachableError({
        candidateAddresses:
          fallbackAddress === undefined
            ? [address.address]
            : [address.address, fallbackAddress.address],
        requestId: request.requestId,
        cause,
      }),
  });
});

const runAppCommand = Effect.fn("cli.app")(function* (flags: {
  readonly baseDir: Option.Option<string>;
  readonly workspaceRoot: Option.Option<string>;
}) {
  const path = yield* Path.Path;
  const rawWorkspaceRoot =
    Option.getOrUndefined(flags.workspaceRoot) ?? (yield* HostProcess.WorkingDirectory);
  const workspaceRoot = path.resolve(yield* expandHomePath(rawWorkspaceRoot));
  const response = yield* sendToDesktopApp({
    baseDir: flags.baseDir,
    makeRequest: (requestId, platform): DesktopAppActivationRequest => ({
      version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
      requestId,
      type: "open-workspace",
      workspaceRoot,
      platform,
    }),
    isResponse: isDesktopAppActivationResponse,
  });
  if (!response.ok) {
    return yield* new DesktopAppRequestFailedError({
      code: response.code,
      requestId: response.requestId,
      workspaceRoot,
      cause: response,
    });
  }

  yield* Console.log(`Opened ${workspaceRoot} in T3 Code.`);
});

const runNetworkAccessCommand = Effect.fn("cli.app.networkAccess")(function* (flags: {
  readonly baseDir: Option.Option<string>;
  readonly mode: Option.Option<DesktopServerExposureMode>;
  readonly json: boolean;
}) {
  const response = yield* sendToDesktopApp({
    baseDir: flags.baseDir,
    makeRequest: (requestId): DesktopAppNetworkAccessRequest => ({
      version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
      requestId,
      type: "network-access",
      ...(Option.isSome(flags.mode) ? { mode: flags.mode.value } : {}),
    }),
    isResponse: isDesktopAppNetworkAccessResponse,
  });
  if (!response.ok) {
    return yield* new DesktopAppNetworkAccessFailedError({
      code: response.code,
      requestId: response.requestId,
      cause: response,
    });
  }

  if (flags.json) {
    const { mode, endpointUrl, restarting } = response;
    yield* printJson({ mode, endpointUrl, restarting });
    return;
  }
  const enabled = response.mode === "network-accessible";
  yield* Console.log(
    enabled
      ? `Network access is on${response.endpointUrl ? ` at ${response.endpointUrl}` : ""}.`
      : "Network access is off. The desktop server only listens on this machine.",
  );
  if (response.restarting) {
    yield* Console.log("The desktop app is restarting to apply the change.");
  }
  if (enabled) {
    yield* Console.log("Run `t3 pair` for a link another device can open.");
  }
});

const networkAccessCommand = Command.make("network-access", {
  baseDir: baseDirFlag,
  mode: Argument.ChoiceWithValue("state", [
    ["on", "network-accessible"],
    ["off", "local-only"],
  ] as const).pipe(
    Argument.withDescription(
      "`on` lets other devices on your network reach the desktop server. Omit to show the current state.",
    ),
    Argument.optional,
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Show or change the desktop app's network access. Changing it restarts the desktop app.",
  ),
  Command.withHandler(runNetworkAccessCommand),
);

export const appCommand = Command.make("app", {
  baseDir: baseDirFlag,
  workspaceRoot: Argument.String("path").pipe(
    Argument.withDescription("Project directory. Default: current directory."),
    Argument.optional,
  ),
}).pipe(
  Command.withDescription("Open a project in the running T3 Code desktop app."),
  Command.withHandler(runAppCommand),
  Command.withSubcommands([networkAccessCommand]),
);
