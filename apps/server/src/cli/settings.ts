import {
  DEFAULT_SERVER_SETTINGS,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  ServerSettings,
  ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import {
  jsonFlag,
  loadLiveShell,
  LiveUsageError,
  resolveLiveProject,
  liveLocationFlags,
  printJson,
  rpc,
  withLiveRpc,
  loadLiveSettings,
  type LiveRpcClient,
} from "./liveRpc.ts";

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const encodeSettings = Schema.encodeSync(ServerSettings);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodePatch = Schema.decodeUnknownEffect(ServerSettingsPatch);
const WRITABLE_KEYS: ReadonlySet<string> = new Set(Object.keys(ServerSettingsPatch.fields));
const PROJECT_KEYS: ReadonlySet<string> = new Set([
  ...PROJECT_SCOPED_SERVER_SETTING_KEYS,
  "providerInstances",
]);
const DEFAULTS: JsonObject = encodeSettings(DEFAULT_SERVER_SETTINGS);

/** Plain JSON when the text parses as JSON, so `true`, `3`, and `null` keep their types. */
export const parseSettingValue = (raw: string): unknown =>
  Option.getOrElse(decodeJson(raw), () => raw);

/**
 * Map keys such as `sourceControlHosts.github.com` contain dots, so each step
 * takes the longest run of segments that names an existing key.
 */
export const splitKeyPath = (root: unknown, key: string): ReadonlyArray<string> => {
  const parts = key.split(".");
  const segments: Array<string> = [];
  let node = root;
  let index = 0;
  while (index < parts.length) {
    let end = index + 1;
    if (isObject(node)) {
      for (let candidate = parts.length; candidate > index + 1; candidate -= 1) {
        if (Object.hasOwn(node, parts.slice(index, candidate).join("."))) {
          end = candidate;
          break;
        }
      }
    }
    const segment = parts.slice(index, end).join(".");
    segments.push(segment);
    node = isObject(node) ? node[segment] : undefined;
    index = end;
  }
  return segments;
};

const getAtPath = (root: unknown, segments: ReadonlyArray<string>): unknown => {
  let node = root;
  for (const segment of segments) {
    if (!isObject(node) || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
};

const setAtPath = (root: unknown, segments: ReadonlyArray<string>, value: unknown): unknown => {
  const [head, ...rest] = segments;
  if (head === undefined) return value;
  const node = isObject(root) ? root : {};
  return { ...node, [head]: setAtPath(node[head], rest, value) };
};

const deleteAtPath = (root: unknown, segments: ReadonlyArray<string>): unknown => {
  const [head, ...rest] = segments;
  if (head === undefined || !isObject(root) || !Object.hasOwn(root, head)) return root;
  if (rest.length === 0) {
    const { [head]: _removed, ...remaining } = root;
    return remaining;
  }
  return { ...root, [head]: deleteAtPath(root[head], rest) };
};

const usage = (detail: string) => new LiveUsageError({ detail });

/**
 * Sends the whole top-level value with the one path changed. Keys differ in
 * how the server applies a patch (deep merge, whole replacement, per-entry
 * merge), and a full value means the same thing under all three. Secrets come
 * back from `getSettings` as the redaction marker, which the server keeps.
 */
export const buildSettingsPatch = (
  current: JsonObject,
  key: string,
  value: unknown,
): Effect.Effect<JsonObject, LiveUsageError> => {
  const [top, ...rest] = splitKeyPath(current, key);
  if (top === undefined || !WRITABLE_KEYS.has(top)) {
    return Effect.fail(usage(`'${top ?? key}' is not a setting t3 can change.`));
  }
  return Effect.succeed({
    [top]: rest.length === 0 ? value : setAtPath(current[top], rest, value),
  });
};

export const buildResetPatch = (
  current: JsonObject,
  key: string,
): Effect.Effect<JsonObject, LiveUsageError> => {
  const segments = splitKeyPath(current, key);
  const fallback = getAtPath(DEFAULTS, segments);
  if (fallback === undefined) {
    return Effect.fail(
      usage(`'${key}' has no default. Set it instead, for example to null or {}.`),
    );
  }
  return buildSettingsPatch(current, key, fallback);
};

/**
 * A project's entry replaces the stored one whole, so the edited entry is sent
 * complete; an emptied entry is sent as null, which removes it.
 */
export const buildProjectOverridePatch = (
  current: JsonObject,
  projectId: string,
  key: string,
  value: { readonly set: unknown } | "unset",
): Effect.Effect<JsonObject, LiveUsageError> => {
  const entry = getAtPath(current, ["projectSettingsOverrides", projectId]) ?? {};
  const segments = splitKeyPath(entry, key);
  const top = segments[0];
  if (top === undefined || !PROJECT_KEYS.has(top)) {
    return Effect.fail(usage(`'${top ?? key}' cannot be overridden per project.`));
  }
  // An entry without `providerInstances` keeps the stored map, so clearing it sends an empty one.
  const next =
    value !== "unset"
      ? setAtPath(entry, segments, value.set)
      : top === "providerInstances" && segments.length === 1
        ? setAtPath(entry, segments, {})
        : deleteAtPath(entry, segments);
  const empty =
    isObject(next) &&
    Object.entries(next).every(
      ([field, fieldValue]) =>
        field === "providerInstances" &&
        isObject(fieldValue) &&
        Object.keys(fieldValue).length === 0,
    );
  return Effect.succeed({ projectSettingsOverrides: { [projectId]: empty ? null : next } });
};

/** One `path = json` line per leaf, so every printed path works with `set`. */
export const flattenSettings = (
  value: unknown,
  prefix: string,
): ReadonlyArray<readonly [string, string]> => {
  if (isObject(value) && (prefix === "" || Object.keys(value).length > 0)) {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenSettings(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [[prefix, value === undefined ? "(not set)" : encodeJson(value)]];
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const validatePatch = (patch: JsonObject) =>
  decodePatch(patch).pipe(
    Effect.mapError((error) => usage(`Invalid value: ${oneLine(error.message)}`)),
  );

const readSettings = (client: LiveRpcClient) =>
  loadLiveSettings(client).pipe(Effect.map(encodeSettings));

const resolveProjectId = Effect.fn("cli.settings.resolveProject")(function* (
  client: LiveRpcClient,
  identifier: string,
) {
  const shell = yield* loadLiveShell(client);
  return (yield* resolveLiveProject(shell.projects, identifier)).id;
});

const projectFlag = Flag.String("project").pipe(
  Flag.withDescription(
    "Project id or a path inside the project: read or write that project's override instead.",
  ),
  Flag.optional,
);
const keyArgument = Argument.String("key").pipe(
  Argument.withDescription("Setting key; nested values use dots, like worktreeCleanup.mode."),
);

const printValues = (root: unknown, keys: ReadonlyArray<string>, json: boolean) => {
  const selected =
    keys.length === 0
      ? [["", root] as const]
      : keys.map((key) => [key, getAtPath(root, splitKeyPath(root, key))] as const);
  if (json) {
    return printJson(keys.length === 0 ? root : Object.fromEntries(selected));
  }
  return Effect.forEach(
    selected.flatMap(([key, value]) => flattenSettings(value, key)),
    ([key, value]) => Console.log(`${key} = ${value}`),
    { discard: true },
  );
};

const settingsShowCommand = Command.make("show", {
  ...liveLocationFlags,
  keys: Argument.String("key").pipe(
    Argument.withDescription("Keys to print. Prints every setting when omitted."),
    Argument.variadic(),
  ),
  project: projectFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Print the running server's settings. Secrets are never shown."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 settings",
      Effect.fn("cli.settings.show")(function* (client) {
        const settings = yield* readSettings(client);
        const root = yield* Option.match(flags.project, {
          onNone: () => Effect.succeed<unknown>(settings),
          onSome: (identifier) =>
            Effect.map(
              resolveProjectId(client, identifier),
              (projectId) => getAtPath(settings, ["projectSettingsOverrides", projectId]) ?? {},
            ),
        });
        const missing = flags.keys.find(
          (key) => getAtPath(root, splitKeyPath(root, key)) === undefined,
        );
        if (missing !== undefined && Option.isNone(flags.project)) {
          return yield* usage(`No setting named '${missing}'.`);
        }
        yield* printValues(root, flags.keys, flags.json);
      }),
    ),
  ),
);

const writeSettings = Effect.fn("cli.settings.write")(function* (
  client: LiveRpcClient,
  input: {
    readonly key: string;
    readonly project: Option.Option<string>;
    readonly value: { readonly set: unknown } | "unset";
  },
) {
  const current = yield* readSettings(client);
  const projectId = Option.isSome(input.project)
    ? yield* resolveProjectId(client, input.project.value)
    : undefined;
  const patch =
    projectId !== undefined
      ? yield* buildProjectOverridePatch(current, projectId, input.key, input.value)
      : input.value === "unset"
        ? yield* buildResetPatch(current, input.key)
        : yield* buildSettingsPatch(current, input.key, input.value.set);
  const decoded = yield* validatePatch(patch);
  const saved = encodeSettings(
    yield* rpc(client[WS_METHODS.serverUpdateSettings]({ patch: decoded })),
  );
  const root =
    projectId === undefined
      ? saved
      : (getAtPath(saved, ["projectSettingsOverrides", projectId]) ?? {});
  yield* printValues(root, [input.key], false);
});

const settingsSetCommand = Command.make("set", {
  ...liveLocationFlags,
  key: keyArgument,
  value: Argument.String("value").pipe(
    Argument.withDescription("New value, read as JSON when it parses (true, 3, null, {...})."),
  ),
  project: projectFlag,
}).pipe(
  Command.withDescription("Change a setting on the running server."),
  Command.withHandler((flags) =>
    withLiveRpc(flags, "t3 settings", (client) =>
      writeSettings(client, {
        key: flags.key,
        project: flags.project,
        value: { set: parseSettingValue(flags.value) },
      }),
    ),
  ),
);

const settingsUnsetCommand = Command.make("unset", {
  ...liveLocationFlags,
  key: keyArgument,
  project: projectFlag,
}).pipe(
  Command.withDescription(
    "Reset a setting to its default, or with --project remove the project's override.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(flags, "t3 settings", (client) =>
      writeSettings(client, { key: flags.key, project: flags.project, value: "unset" }),
    ),
  ),
);

export const settingsCommand = Command.make("settings").pipe(
  Command.withDescription("Read and change the running server's settings."),
  Command.withSubcommands([settingsShowCommand, settingsSetCommand, settingsUnsetCommand]),
);
