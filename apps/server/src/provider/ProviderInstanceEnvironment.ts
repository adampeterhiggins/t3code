import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

import { expandHomePath } from "../pathExpansion.ts";

// Variables whose values are filesystem paths that users write with a
// leading `~`; spawned children do not shell-expand env values.
const HOME_EXPANDED_VARIABLE_NAMES = new Set([
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "CURSOR_CONFIG_DIR",
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
