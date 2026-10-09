import {
  defaultInstanceIdForDriver,
  type ProviderDriverKind,
  type ProviderInstanceEnvironment,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePath } from "./pathExpansion.ts";

// Variables whose values are filesystem paths that users write with a
// leading `~`; spawned children do not shell-expand env values.
const HOME_EXPANDED_VARIABLE_NAMES = new Set([
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "CURSOR_CONFIG_DIR",
  "GROK_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!environment || environment.length === 0) {
    return baseEnv;
  }

  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    next[variable.name] = HOME_EXPANDED_VARIABLE_NAMES.has(variable.name)
      ? expandHomePath(variable.value)
      : variable.value;
  }
  return next;
}

/**
 * Resolve an instance `homePath` to an absolute directory, or `undefined`
 * when the instance uses the CLI's default location.
 */
export const resolveProviderHomePath = Effect.fn("resolveProviderHomePath")(function* (
  homePath: string,
): Effect.fn.Return<string | undefined, never, Path.Path> {
  const path = yield* Path.Path;
  const trimmed = homePath.trim();
  if (trimmed.length === 0) return undefined;
  return path.resolve(expandHomePath(trimmed));
});

/**
 * Private home an added instance uses when its `homePath` is blank, so a
 * second account never signs in over the first. The default instance keeps
 * the CLI's own location (the user's existing login) and gets `""`.
 */
export function defaultInstanceHomePath(
  path: Path.Path,
  stateDir: string,
  driver: ProviderDriverKind,
  instanceId: ProviderInstanceId,
): string {
  return instanceId === defaultInstanceIdForDriver(driver)
    ? ""
    : path.join(stateDir, "provider-homes", driver, instanceId);
}

/**
 * The instance's configured `homePath`, or its private default home (created
 * on demand) when blank. An instance environment variable that already picks
 * the home (`homeVariables`, e.g. `XDG_DATA_HOME`) keeps working, so no default
 * is applied then. Drivers pass the result wherever they read `homePath`.
 */
export const resolveInstanceHomePath = Effect.fn("resolveInstanceHomePath")(function* (input: {
  readonly homePath: string;
  readonly stateDir: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly environment: ProviderInstanceEnvironment | undefined;
  readonly homeVariables: ReadonlyArray<string>;
}): Effect.fn.Return<string, never, FileSystem.FileSystem | Path.Path> {
  if (input.homePath.trim()) return input.homePath;
  if (input.environment?.some((variable) => input.homeVariables.includes(variable.name))) return "";
  const path = yield* Path.Path;
  const home = defaultInstanceHomePath(path, input.stateDir, input.driver, input.instanceId);
  if (home) {
    const fileSystem = yield* FileSystem.FileSystem;
    // A home that cannot be created surfaces as the CLI's own error on first use.
    yield* fileSystem.makeDirectory(home, { recursive: true }).pipe(Effect.ignore);
  }
  return home;
});

/**
 * Point each of `variableNames` at the instance's `homePath` so logins and
 * CLI state live in a per-instance directory (e.g. `GROK_HOME` for Grok,
 * `XDG_DATA_HOME` for Devin and OpenCode). The configured `homePath` wins
 * over an instance environment variable of the same name.
 */
export const mergeProviderHomePathEnvironment = Effect.fn("mergeProviderHomePathEnvironment")(
  function* (
    homePath: string,
    variableNames: ReadonlyArray<string>,
    baseEnv?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
    const resolvedBaseEnv = baseEnv ?? process.env;
    const resolvedHomePath = yield* resolveProviderHomePath(homePath);
    if (resolvedHomePath === undefined) return resolvedBaseEnv;
    return {
      ...resolvedBaseEnv,
      ...Object.fromEntries(variableNames.map((name) => [name, resolvedHomePath])),
    };
  },
);

/**
 * The instance environment with each of `variableNames` pointed at `homePath`.
 * Orchestration adapters build their own process env from the instance
 * environment, so per-instance homes must travel in it to reach them.
 */
export const withProviderHomePathVariables = Effect.fn("withProviderHomePathVariables")(function* (
  homePath: string,
  variableNames: ReadonlyArray<string>,
  environment: ProviderInstanceEnvironment,
): Effect.fn.Return<ProviderInstanceEnvironment, never, Path.Path> {
  const resolvedHomePath = yield* resolveProviderHomePath(homePath);
  if (resolvedHomePath === undefined) return environment;
  const names = new Set(variableNames);
  return [
    ...environment.filter((variable) => !names.has(variable.name)),
    ...variableNames.map((name) => ({ name, value: resolvedHomePath, sensitive: false })),
  ];
});
