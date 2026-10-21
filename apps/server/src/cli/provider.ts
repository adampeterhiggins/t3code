import {
  ProviderInstanceId,
  WS_METHODS,
  type ServerProvider,
  type ServerProviders,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import {
  jsonFlag,
  LiveUsageError,
  liveLocationFlags,
  printJson,
  rpc,
  withLiveRpc,
  type LiveRpcClient,
} from "./liveRpc.ts";

const providerSummary = (provider: ServerProvider) => ({
  instanceId: provider.instanceId,
  driver: provider.driver,
  displayName: provider.displayName ?? null,
  enabled: provider.enabled,
  installed: provider.installed,
  status: provider.status,
  auth: provider.auth.status,
  account: provider.auth.email ?? provider.auth.label ?? null,
  signInMethod: provider.auth.methodId ?? null,
  version: provider.version,
  message: provider.message ?? null,
});

/** Padded columns; the message goes last because it is the only long field. */
export const formatProviderTable = (providers: ServerProviders): ReadonlyArray<string> => {
  const rows = providers.map((provider) => {
    const summary = providerSummary(provider);
    return [
      summary.instanceId,
      summary.driver,
      summary.enabled ? summary.status : "disabled",
      summary.account === null ? summary.auth : `${summary.auth} (${summary.account})`,
      summary.installed ? (summary.version ?? "unknown") : "not installed",
      summary.message ?? "",
    ];
  });
  const header = ["INSTANCE", "DRIVER", "STATUS", "AUTH", "VERSION", "MESSAGE"];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  return [header, ...rows].map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
};

const printProviders = (providers: ServerProviders, json: boolean) =>
  json
    ? printJson(providers.map(providerSummary))
    : Effect.forEach(formatProviderTable(providers), (line) => Console.log(line), {
        discard: true,
      });

const decodeInstanceIdValue = Schema.decodeEffect(ProviderInstanceId);
const decodeInstanceId = (value: string) =>
  decodeInstanceIdValue(value.trim()).pipe(
    Effect.mapError(
      () => new LiveUsageError({ detail: `'${value}' is not a provider instance id.` }),
    ),
  );

const instanceArgument = Argument.String("instance").pipe(
  Argument.withDescription("Provider instance id, as shown by t3 provider list."),
);

const providerListCommand = Command.make("list", {
  ...liveLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List provider instances with their status, sign-in, and version."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 provider",
      Effect.fn("cli.provider.list")(function* (client) {
        const config = yield* rpc(client[WS_METHODS.serverGetConfig]({}));
        yield* printProviders(config.providers, flags.json);
      }),
    ),
  ),
);

const providerRefreshCommand = Command.make("refresh", {
  ...liveLocationFlags,
  instance: instanceArgument.pipe(Argument.optional),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Recheck providers' install, sign-in, and models, then list them."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 provider",
      Effect.fn("cli.provider.refresh")(function* (client) {
        const instanceId = Option.isSome(flags.instance)
          ? yield* decodeInstanceId(flags.instance.value)
          : undefined;
        const result = yield* rpc(
          client[WS_METHODS.serverRefreshProviders]({
            refreshModels: true,
            ...(instanceId === undefined ? {} : { instanceId }),
          }),
        );
        yield* printProviders(
          result.providers.filter(
            (provider) => instanceId === undefined || provider.instanceId === instanceId,
          ),
          flags.json,
        );
      }),
    ),
  ),
);

/**
 * Upserts the stored instance with `enabled` changed, as the Providers settings
 * card does. Its redacted environment secrets go back as the marker the server keeps.
 */
const setInstanceEnabled = Effect.fn("cli.provider.setEnabled")(function* (
  client: LiveRpcClient,
  rawInstanceId: string,
  enabled: boolean,
) {
  const instanceId = yield* decodeInstanceId(rawInstanceId);
  const config = yield* rpc(client[WS_METHODS.serverGetConfig]({}));
  const stored = config.settings.providerInstances[instanceId];
  const live = config.providers.find((provider) => provider.instanceId === instanceId);
  const driver = stored?.driver ?? live?.driver;
  if (driver === undefined) {
    return yield* new LiveUsageError({
      detail: `No provider instance '${instanceId}'. Run t3 provider list to see them.`,
    });
  }
  yield* rpc(
    client[WS_METHODS.serverUpdateSettings]({
      patch: {},
      providerInstanceMutation: {
        operation: "upsert",
        instanceId,
        instance: { ...stored, driver, enabled },
      },
    }),
  );
  yield* Console.log(`${instanceId} ${enabled ? "enabled" : "disabled"}`);
});

const providerEnableCommand = Command.make("enable", {
  ...liveLocationFlags,
  instance: instanceArgument,
}).pipe(
  Command.withDescription("Enable a provider instance."),
  Command.withHandler((flags) =>
    withLiveRpc(flags, "t3 provider", (client) => setInstanceEnabled(client, flags.instance, true)),
  ),
);

const providerDisableCommand = Command.make("disable", {
  ...liveLocationFlags,
  instance: instanceArgument,
}).pipe(
  Command.withDescription("Disable a provider instance."),
  Command.withHandler((flags) =>
    withLiveRpc(flags, "t3 provider", (client) =>
      setInstanceEnabled(client, flags.instance, false),
    ),
  ),
);

export const providerCommand = Command.make("provider").pipe(
  Command.withDescription("List, refresh, enable, and disable the running server's providers."),
  Command.withSubcommands([
    providerListCommand,
    providerRefreshCommand,
    providerEnableCommand,
    providerDisableCommand,
  ]),
);
