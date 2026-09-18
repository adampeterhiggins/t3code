import type { CursorSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveProviderHomePath } from "../ProviderInstanceEnvironment.ts";

/**
 * Merge the instance's `homePath` into the spawned environment as
 * `CURSOR_CONFIG_DIR`, so logins, sessions, and CLI config live in a
 * per-instance directory. A configured `homePath` wins over an instance
 * environment variable of the same name (same rule as `CODEX_HOME`).
 *
 * `AGENT_CLI_CREDENTIAL_STORE=file` is defaulted on so `cursor-agent login`
 * writes `auth.json` inside the config dir; the default macOS keychain entry
 * is global and would otherwise be shared by every instance. An explicit
 * instance variable still overrides the default.
 */
export const makeCursorEnvironment = Effect.fn("makeCursorEnvironment")(function* (
  config: Pick<CursorSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const configDir = yield* resolveProviderHomePath(config.homePath);
  if (configDir === undefined) return resolvedBaseEnv;
  return {
    AGENT_CLI_CREDENTIAL_STORE: "file",
    ...resolvedBaseEnv,
    CURSOR_CONFIG_DIR: configDir,
  };
});
