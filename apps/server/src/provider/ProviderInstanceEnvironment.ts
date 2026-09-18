import type { ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../pathExpansion.ts";

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
