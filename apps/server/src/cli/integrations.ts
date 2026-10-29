import {
  DiscordSnowflake,
  discordBotInviteUrl,
  NOTION_REDIRECT_URI,
  GOOGLE_REDIRECT_URI,
  WS_METHODS,
  type DiscordConnectionState,
  type GranolaConnectionState,
  type LinearConnectionState,
  type NotionConnectionState,
  type GoogleConnectionState,
  type ServerSettings,
  type SlackConnectionState,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";

import * as ExternalLauncher from "../process/externalLauncher.ts";
import {
  jsonFlag,
  liveLocationFlags,
  LiveRpcFailedError,
  LiveUsageError,
  printJson,
  rpc,
  withLiveRpc,
  loadLiveSettings,
  type LiveRpcClient,
} from "./liveRpc.ts";

const SESSION_LABEL = "t3 integration cli";
const isDiscordSnowflake = Schema.is(DiscordSnowflake);

const LOGIN_INTEGRATIONS = ["linear", "slack", "notion", "google", "granola"] as const;
export type LoginIntegration = (typeof LOGIN_INTEGRATIONS)[number];
export type IntegrationName = LoginIntegration | "discord";

const TITLES: Readonly<Record<IntegrationName, string>> = {
  linear: "Linear",
  slack: "Slack",
  notion: "Notion",
  google: "Google",
  granola: "Granola",
  discord: "Discord",
};

/** The fields every integration's connection state shares, for status and login. */
export interface IntegrationState {
  readonly name: IntegrationName;
  readonly phase: "disconnected" | "waiting" | "connected" | "failed";
  readonly account: string | null;
  readonly flowId: string | null;
  readonly url: string | null;
  /** Granola's device-flow code, confirmed on its page. */
  readonly userCode: string | null;
  readonly message: string | null;
}

const base = (
  name: IntegrationName,
  state: { readonly phase: IntegrationState["phase"]; readonly message: string | null },
  account: string | null,
) => ({
  name,
  phase: state.phase,
  account,
  flowId: null,
  url: null,
  userCode: null,
  message: state.message,
});

export const fromLinear = (state: LinearConnectionState): IntegrationState => ({
  ...base(
    "linear",
    state,
    state.account &&
      `${state.account.name} (${state.account.email}) in ${state.account.workspaceName}`,
  ),
  flowId: state.flowId,
  url: state.authorizationUrl,
});

const fromSlack = (state: SlackConnectionState): IntegrationState => ({
  ...base(
    "slack",
    state,
    state.account && `${state.account.userName} in ${state.account.teamName}`,
  ),
  flowId: state.flowId,
  url: state.authorizationUrl,
});

const fromNotion = (state: NotionConnectionState): IntegrationState => ({
  ...base("notion", state, state.account?.workspaceName ?? null),
  flowId: state.flowId,
  url: state.authorizationUrl,
});
const fromGoogle = (state: GoogleConnectionState): IntegrationState => ({
  ...base("google", state, state.account?.email ?? null),
  flowId: state.flowId,
  url: state.authorizationUrl,
});

export const fromGranola = (state: GranolaConnectionState): IntegrationState => ({
  ...base(
    "granola",
    state,
    state.account &&
      (state.account.workspaceName === null
        ? state.account.email
        : `${state.account.email} (${state.account.workspaceName})`),
  ),
  flowId: state.flowId,
  url: state.verificationUrl,
  userCode: state.userCode,
});

const fromDiscord = (state: DiscordConnectionState): IntegrationState =>
  base("discord", state, state.account && `bot ${state.account.botName}`);

/** Linear has no toggle; the others can be switched off in settings. */
export const integrationEnabled = (
  name: IntegrationName,
  settings: Pick<
    ServerSettings,
    | "enableSlackIntegration"
    | "enableDiscordIntegration"
    | "enableNotionIntegration"
    | "enableGoogleIntegration"
    | "enableGranolaIntegration"
  >,
): boolean => {
  switch (name) {
    case "linear":
      return true;
    case "slack":
      return settings.enableSlackIntegration;
    case "notion":
      return settings.enableNotionIntegration;
    case "google":
      return settings.enableGoogleIntegration;
    case "granola":
      return settings.enableGranolaIntegration;
    case "discord":
      return settings.enableDiscordIntegration;
  }
};

export const statusLine = (state: IntegrationState, enabled: boolean): string => {
  const detail =
    state.phase === "connected"
      ? (state.account ?? "")
      : state.phase === "failed"
        ? (state.message ?? "")
        : "";
  const parts = [state.name.padEnd(8), state.phase.padEnd(12), detail];
  if (!enabled) parts.push("(turned off in settings)");
  return parts
    .filter((part) => part.length > 0)
    .join(" ")
    .trimEnd();
};

export type LoginProgress =
  | { readonly _tag: "Waiting" }
  | { readonly _tag: "Connected"; readonly account: string | null }
  | { readonly _tag: "Failed"; readonly message: string };

/** Where one sign-in stands, judged only by its own flow so a newer one can't pass for it. */
export const loginProgress = (state: IntegrationState, flowId: string): LoginProgress => {
  const title = TITLES[state.name];
  switch (state.phase) {
    case "connected":
      return { _tag: "Connected", account: state.account };
    case "waiting":
      return state.flowId === flowId
        ? { _tag: "Waiting" }
        : { _tag: "Failed", message: `Another ${title} sign-in replaced this one.` };
    case "failed":
      return { _tag: "Failed", message: state.message ?? `${title} sign-in failed.` };
    case "disconnected":
      return { _tag: "Failed", message: `${title} sign-in was cancelled.` };
  }
};

/**
 * A line typed at the paste-back prompt. Terminals and chat apps often wrap a
 * copied URL in quotes or angle brackets; the server rejects anything else
 * that isn't its callback URL with a message worth showing.
 */
export const readPastedCallback = (line: string): string | null => {
  let value = line.trim();
  const wrapped = /^(["'<])(.*)([>"'])$/s.exec(value);
  if (wrapped !== null && (wrapped[1] === "<" ? wrapped[3] === ">" : wrapped[1] === wrapped[3])) {
    value = (wrapped[2] ?? "").trim();
  }
  return value.length === 0 ? null : value;
};

interface LoginInput {
  readonly clientId: Option.Option<string>;
  readonly clientSecret: Option.Option<string>;
}

/** The first frame of a state subscription is the current state. */
const firstState = <A, E>(changes: Stream.Stream<A, E>, name: IntegrationName) =>
  rpc(Stream.runHead(changes)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new LiveRpcFailedError({ detail: `The server sent no ${TITLES[name]} status.` }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

/** One integration's RPCs, with its state normalised and failures as one-line errors. */
const makeIntegrationClient = <S, ES, E>(input: {
  readonly name: IntegrationName;
  readonly normalize: (state: S) => IntegrationState;
  readonly changes: Stream.Stream<S, ES>;
  readonly start: (input: LoginInput) => Effect.Effect<S, E>;
  readonly complete: ((flowId: string, callbackUrl: string) => Effect.Effect<S, E>) | null;
  readonly cancel: (flowId: string) => Effect.Effect<S, E>;
  readonly disconnect: Effect.Effect<S, E>;
}) => {
  const call = (effect: Effect.Effect<S, E>) => rpc(Effect.map(effect, input.normalize));
  const { complete } = input;
  return {
    current: Effect.map(firstState(input.changes, input.name), input.normalize),
    /** Resolves once this flow connects, fails, or is replaced; None if the stream ends. */
    outcome: (flowId: string) =>
      rpc(
        input.changes.pipe(
          Stream.map((state) => loginProgress(input.normalize(state), flowId)),
          Stream.filter((progress) => progress._tag !== "Waiting"),
          Stream.runHead,
        ),
      ),
    start: (login: LoginInput) => call(input.start(login)),
    complete:
      complete === null
        ? null
        : (flowId: string, callbackUrl: string) => call(complete(flowId, callbackUrl)),
    cancel: (flowId: string) => call(input.cancel(flowId)),
    disconnect: call(input.disconnect),
  };
};
type IntegrationClient = ReturnType<typeof makeIntegrationClient>;

const loginClients = (client: LiveRpcClient): Record<LoginIntegration, IntegrationClient> => ({
  linear: makeIntegrationClient({
    name: "linear",
    normalize: fromLinear,
    changes: client[WS_METHODS.linearSubscribeState]({}),
    start: () => client[WS_METHODS.linearStartLogin]({}),
    complete: (flowId, callbackUrl) =>
      client[WS_METHODS.linearCompleteLogin]({ flowId, callbackUrl }),
    cancel: (flowId) => client[WS_METHODS.linearCancelLogin]({ flowId }),
    disconnect: client[WS_METHODS.linearDisconnect]({}),
  }),
  slack: makeIntegrationClient({
    name: "slack",
    normalize: fromSlack,
    changes: client[WS_METHODS.slackSubscribeState]({}),
    start: (input) =>
      client[WS_METHODS.slackStartLogin](
        Option.match(input.clientId, { onNone: () => ({}), onSome: (clientId) => ({ clientId }) }),
      ),
    complete: (flowId, callbackUrl) =>
      client[WS_METHODS.slackCompleteLogin]({ flowId, callbackUrl }),
    cancel: (flowId) => client[WS_METHODS.slackCancelLogin]({ flowId }),
    disconnect: client[WS_METHODS.slackDisconnect]({}),
  }),
  notion: makeIntegrationClient({
    name: "notion",
    normalize: fromNotion,
    changes: client[WS_METHODS.notionSubscribeState]({}),
    start: (input) =>
      client[WS_METHODS.notionStartLogin](
        Option.isSome(input.clientId) && Option.isSome(input.clientSecret)
          ? {
              credentials: {
                clientId: input.clientId.value,
                clientSecret: input.clientSecret.value,
              },
            }
          : {},
      ),
    complete: (flowId, callbackUrl) =>
      client[WS_METHODS.notionCompleteLogin]({ flowId, callbackUrl }),
    cancel: (flowId) => client[WS_METHODS.notionCancelLogin]({ flowId }),
    disconnect: client[WS_METHODS.notionDisconnect]({}),
  }),
  google: makeIntegrationClient({
    name: "google",
    normalize: fromGoogle,
    changes: client[WS_METHODS.googleSubscribeState]({}),
    start: (input) =>
      client[WS_METHODS.googleStartLogin](
        Option.isSome(input.clientId) && Option.isSome(input.clientSecret)
          ? {
              credentials: {
                clientId: input.clientId.value,
                clientSecret: input.clientSecret.value,
              },
            }
          : {},
      ),
    complete: (flowId, callbackUrl) =>
      client[WS_METHODS.googleCompleteLogin]({ flowId, callbackUrl }),
    cancel: (flowId) => client[WS_METHODS.googleCancelLogin]({ flowId }),
    disconnect: client[WS_METHODS.googleDisconnect]({}),
  }),
  granola: makeIntegrationClient({
    name: "granola",
    normalize: fromGranola,
    changes: client[WS_METHODS.granolaSubscribeState]({}),
    start: () => client[WS_METHODS.granolaStartLogin]({}),
    // The device flow completes on Granola's side; there is no redirect to paste.
    complete: null,
    cancel: (flowId) => client[WS_METHODS.granolaCancelLogin]({ flowId }),
    disconnect: client[WS_METHODS.granolaDisconnect]({}),
  }),
});

const stdinLines = Stdio.Stdio.pipe(
  Effect.map((stdio) => stdio.stdin.pipe(Stream.decodeText(), Stream.splitLines)),
  Stream.unwrap,
);

const stdinIsTerminal = Stdio.Stdio.pipe(Effect.flatMap((stdio) => stdio.stdinIsTerminal));

/** One non-empty line, so a terminal user can paste and press Enter without Ctrl-D. */
const readSecretLine = Effect.fn("cli.integration.readSecretLine")(function* (prompt: string) {
  if (yield* stdinIsTerminal) yield* Console.error(prompt);
  const line = yield* stdinLines.pipe(
    Stream.map((value) => value.trim()),
    Stream.filter((value) => value.length > 0),
    Stream.runHead,
  );
  if (Option.isNone(line)) {
    return yield* new LiveUsageError({ detail: "Nothing was read from stdin." });
  }
  return line.value;
});

/** `-` reads the value from stdin, keeping it out of shell history. */
const readSecretFlag = (value: string, prompt: string) =>
  value === "-" ? readSecretLine(prompt) : Effect.succeed(value);

/**
 * Opens the sign-in page on this machine. Skipped over SSH, where it would open
 * on a screen the user can't see; the printed URL covers that case.
 */
const openInBrowser = Effect.fn("cli.integration.openInBrowser")(
  function* (url: string) {
    const env = yield* HostProcess.Environment;
    if (env.SSH_CONNECTION !== undefined || env.SSH_TTY !== undefined) return false;
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    return yield* launcher.launchBrowser(url).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  },
  Effect.provide(ExternalLauncher.layer),
  // The URL carries the flow's OAuth state.
  Effect.withTracerEnabled(false),
);

const resolveLoginInput = Effect.fn("cli.integration.resolveLoginInput")(function* (
  name: LoginIntegration,
  current: IntegrationState,
  oauthState: NotionConnectionState | GoogleConnectionState | null,
  flags: { readonly clientId: Option.Option<string>; readonly clientSecret: Option.Option<string> },
) {
  if (Option.isSome(flags.clientId) && name !== "slack" && name !== "notion" && name !== "google") {
    return yield* new LiveUsageError({
      detail: "--client-id applies to slack, notion and google only.",
    });
  }
  if (Option.isSome(flags.clientSecret) && name !== "notion" && name !== "google") {
    return yield* new LiveUsageError({
      detail: "--client-secret applies to notion and google only.",
    });
  }
  if (current.phase === "connected") {
    return yield* new LiveUsageError({
      detail: `${TITLES[name]} is already connected (${current.account ?? "unknown account"}). Run t3 integration logout ${name} first.`,
    });
  }
  if ((name !== "notion" && name !== "google") || oauthState === null) {
    return { clientId: flags.clientId, clientSecret: Option.none<string>() };
  }
  const redirectUri =
    oauthState.redirectUri ?? (name === "google" ? GOOGLE_REDIRECT_URI : NOTION_REDIRECT_URI);
  if (Option.isNone(flags.clientSecret)) {
    const reusable =
      oauthState.configured &&
      Option.match(flags.clientId, {
        onNone: () => true,
        onSome: (clientId) => clientId === oauthState.clientId,
      });
    if (!reusable) {
      return yield* new LiveUsageError({
        detail: `${TITLES[name]} needs an OAuth client ID and secret (redirect URI ${redirectUri}). Pass --client-id <id> --client-secret - and paste the secret on stdin.`,
      });
    }
    return { clientId: Option.none<string>(), clientSecret: Option.none<string>() };
  }
  if (Option.isNone(flags.clientId)) {
    return yield* new LiveUsageError({ detail: "--client-secret needs --client-id." });
  }
  const clientSecret = yield* readSecretFlag(
    flags.clientSecret.value,
    `Paste the ${TITLES[name]} client secret, then press Enter:`,
  );
  return { clientId: flags.clientId, clientSecret: Option.some(clientSecret) };
});

/**
 * Sends each line typed or piped on stdin as the redirect URL, for a browser on
 * another machine whose redirect to this server's loopback port never lands.
 * A rejected paste is reported and the next line tried.
 */
const pasteBackLoop = (complete: NonNullable<IntegrationClient["complete"]>, flowId: string) =>
  stdinLines.pipe(
    Stream.map(readPastedCallback),
    Stream.filter((callbackUrl) => callbackUrl !== null),
    Stream.runForEach((callbackUrl) =>
      complete(flowId, callbackUrl).pipe(Effect.catch((error) => Console.error(error.message))),
    ),
    // stdin closing (a pipe or </dev/null) leaves the browser path to finish.
    Effect.ignore,
  );

const waitForLogin = Effect.fn("cli.integration.waitForLogin")(function* (
  integration: IntegrationClient,
  flowId: string,
) {
  if (integration.complete !== null) {
    yield* Effect.forkScoped(pasteBackLoop(integration.complete, flowId));
  }
  return yield* integration.outcome(flowId);
}, Effect.scoped);

const currentNotionState = (client: LiveRpcClient) =>
  firstState(client[WS_METHODS.notionSubscribeState]({}), "notion");

const login = Effect.fn("cli.integration.login")(function* (
  client: LiveRpcClient,
  name: LoginIntegration,
  flags: {
    readonly clientId: Option.Option<string>;
    readonly clientSecret: Option.Option<string>;
    readonly noWait: boolean;
    readonly noOpen: boolean;
  },
) {
  const integration = loginClients(client)[name];
  const title = TITLES[name];
  const oauthState =
    name === "notion"
      ? yield* currentNotionState(client)
      : name === "google"
        ? yield* firstState(client[WS_METHODS.googleSubscribeState]({}), "google")
        : null;
  const current = yield* integration.current;
  const input = yield* resolveLoginInput(name, current, oauthState, flags);
  const started = yield* integration.start(input);
  if (started.phase !== "waiting" || started.flowId === null || started.url === null) {
    return yield* new LiveRpcFailedError({
      detail: started.message ?? `${title} sign-in did not start.`,
    });
  }
  const flowId = started.flowId;
  yield* Console.log(started.url);
  if (started.userCode !== null) {
    yield* Console.error(`Confirm the code ${started.userCode} on ${title}'s page.`);
  }
  const opened = flags.noOpen ? false : yield* openInBrowser(started.url);
  yield* Console.error(
    opened
      ? `Opened ${title} in your browser. If it didn't appear, open the link above.`
      : `Open the link above to sign in to ${title}.`,
  );
  if (flags.noWait) return;
  if (integration.complete !== null && (yield* stdinIsTerminal)) {
    yield* Console.error(
      `If the browser is on another machine, ${title} ends on a page that won't load. Paste that page's URL here and press Enter.`,
    );
  }
  yield* Console.error("Waiting for sign-in. Ctrl-C cancels it.");
  const outcome = yield* waitForLogin(integration, flowId).pipe(
    Effect.onInterrupt(() => integration.cancel(flowId).pipe(Effect.ignore)),
  );
  if (Option.isNone(outcome)) {
    return yield* new LiveRpcFailedError({
      detail: `The server stopped reporting ${title} sign-in.`,
    });
  }
  if (outcome.value._tag === "Failed") {
    return yield* new LiveRpcFailedError({ detail: outcome.value.message });
  }
  yield* Console.log(
    outcome.value.account === null
      ? `${title} connected.`
      : `${title} connected: ${outcome.value.account}.`,
  );
});

const integrationArgument = Argument.Literals("integration", LOGIN_INTEGRATIONS);

const integrationStatusCommand = Command.make("status", {
  ...liveLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show which integrations this server is connected to."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      SESSION_LABEL,
      Effect.fn("cli.integration.status")(function* (client) {
        const clients = loginClients(client);
        const [settings, ...states] = yield* Effect.all(
          [
            loadLiveSettings(client),
            ...LOGIN_INTEGRATIONS.map((name) => clients[name].current),
            Effect.map(
              firstState(client[WS_METHODS.discordSubscribeState]({}), "discord"),
              fromDiscord,
            ),
          ],
          { concurrency: "unbounded" },
        );
        const rows = states.map((state) => ({
          name: state.name,
          phase: state.phase,
          account: state.account,
          message: state.phase === "failed" ? state.message : null,
          enabled: integrationEnabled(state.name, settings),
        }));
        if (flags.json) return yield* printJson(rows);
        for (const [index, row] of rows.entries()) {
          const state = states[index];
          if (state !== undefined) yield* Console.log(statusLine(state, row.enabled));
        }
      }),
    ),
  ),
);

const integrationLoginCommand = Command.make("login", {
  ...liveLocationFlags,
  integration: integrationArgument,
  clientId: Flag.String("client-id").pipe(
    Flag.withDescription(
      "Slack: your Slack app's client ID. Notion/Google: your OAuth client ID. Defaults to the one last used.",
    ),
    Flag.optional,
  ),
  clientSecret: Flag.String("client-secret").pipe(
    Flag.withDescription("Notion/Google: the OAuth client secret, or - to read it from stdin."),
    Flag.optional,
  ),
  noWait: Flag.Boolean("no-wait").pipe(
    Flag.withDescription("Print the sign-in link and exit instead of waiting."),
    Flag.withDefault(false),
  ),
  noOpen: Flag.Boolean("no-open").pipe(
    Flag.withDescription("Don't open the sign-in link in a browser on this machine."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Sign this server in to an integration. Prints the sign-in link and waits until it finishes.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(flags, SESSION_LABEL, (client) => login(client, flags.integration, flags)),
  ),
);

const integrationLogoutCommand = Command.make("logout", {
  ...liveLocationFlags,
  integration: Argument.Literals("integration", [...LOGIN_INTEGRATIONS, "discord"] as const),
}).pipe(
  Command.withDescription("Disconnect an integration from this server."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      SESSION_LABEL,
      Effect.fn("cli.integration.logout")(function* (client) {
        if (flags.integration === "discord") {
          yield* rpc(client[WS_METHODS.discordDisconnect]({}));
        } else {
          yield* loginClients(client)[flags.integration].disconnect;
        }
        yield* Console.log(`${TITLES[flags.integration]} disconnected.`);
      }),
    ),
  ),
);

const discordConnectCommand = Command.make("connect", {
  ...liveLocationFlags,
  token: Flag.String("token").pipe(
    Flag.withDescription(
      "The bot token from the Discord Developer Portal, or - (the default) to read it from stdin.",
    ),
    Flag.withDefault("-"),
  ),
}).pipe(
  Command.withDescription("Connect Discord with your bot's token."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      SESSION_LABEL,
      Effect.fn("cli.integration.discord.connect")(function* (client) {
        const botToken = yield* readSecretFlag(
          flags.token,
          "Paste the Discord bot token, then press Enter:",
        );
        const state = yield* rpc(client[WS_METHODS.discordConnect]({ botToken }));
        if (state.phase !== "connected" || state.account === null) {
          return yield* new LiveRpcFailedError({
            detail: state.message ?? "Discord did not accept the bot token.",
          });
        }
        yield* Console.log(`Discord connected as bot ${state.account.botName}.`);
        yield* Console.log(
          `Add it to a server: ${discordBotInviteUrl(state.account.applicationId)}`,
        );
      }),
    ),
  ),
);

const discordServersCommand = Command.make("servers", {
  ...liveLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List the Discord servers the bot is in."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      SESSION_LABEL,
      Effect.fn("cli.integration.discord.servers")(function* (client) {
        const { servers } = yield* rpc(client[WS_METHODS.discordListServers]({}));
        if (flags.json) return yield* printJson(servers);
        if (servers.length === 0) return yield* Console.error("The bot is in no servers.");
        for (const server of servers) {
          yield* Console.log(`${server.id}  ${server.name}`);
        }
      }),
    ),
  ),
);

const discordLeaveCommand = Command.make("leave", {
  ...liveLocationFlags,
  server: Argument.String("server").pipe(
    Argument.withDescription("Server id, from t3 integration discord servers."),
  ),
}).pipe(
  Command.withDescription("Remove the bot from a Discord server."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      SESSION_LABEL,
      Effect.fn("cli.integration.discord.leave")(function* (client) {
        const guildId = flags.server.trim();
        if (!isDiscordSnowflake(guildId)) {
          return yield* new LiveUsageError({ detail: `'${flags.server}' is not a server id.` });
        }
        yield* rpc(client[WS_METHODS.discordLeaveServer]({ guildId }));
        yield* Console.log("Left the server.");
      }),
    ),
  ),
);

const discordCommand = Command.make("discord").pipe(
  Command.withDescription("Manage the Discord bot this server reads as."),
  Command.withSubcommands([discordConnectCommand, discordServersCommand, discordLeaveCommand]),
);

export const integrationCommand = Command.make("integration").pipe(
  Command.withDescription(
    "Connect, check, and disconnect Linear, Slack, Notion, Google, Granola, and Discord on the running server.",
  ),
  Command.withSubcommands([
    integrationStatusCommand,
    integrationLoginCommand,
    integrationLogoutCommand,
    discordCommand,
  ]),
);
