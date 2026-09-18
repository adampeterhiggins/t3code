import * as NodeOS from "node:os";

import type { CursorSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as PlatformError from "effect/PlatformError";

import { resolveProviderHomePath } from "../ProviderInstanceEnvironment.ts";

/**
 * Cursor's credential store resolves `auth.json` from `homedir()` on macOS and
 * `$XDG_CONFIG_HOME` on Linux — it never consults `CURSOR_CONFIG_DIR`, so a
 * config-dir override alone cannot isolate logins. The working mechanism is a
 * per-instance shadow HOME: `.cursor` is a real private directory while every
 * other home entry symlinks back to the real one, keeping the agent's own
 * tools (git, ssh, shells) transparent.
 */

// `.cursor` holds auth.json, cli-config.json, and session history on every
// platform; `.config/cursor` is the Linux auth.json location. Both must stay
// real (private) inside the shadow home.
const PRIVATE_ENTRY_NAMES = new Set([".cursor", ".config"]);
const PRIVATE_CONFIG_ENTRY_NAMES = new Set(["cursor"]);

export class CursorShadowHomeError extends Schema.TaggedError<CursorShadowHomeError>()(
  "CursorShadowHomeError",
  {
    homePath: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Cursor instance home '${this.homePath}': ${this.detail}`;
  }
}

type LinkState = "missing" | "not-symlink" | { readonly target: string };

const isNotSymlinkError = (error: PlatformError.PlatformError): boolean => {
  const cause = error.reason.cause;
  return (
    error.reason._tag === "Unknown" &&
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "EINVAL"
  );
};

const readLinkState = (
  fileSystem: FileSystem.FileSystem,
  linkPath: string,
): Effect.Effect<LinkState, never> =>
  fileSystem.readLink(linkPath).pipe(
    Effect.map((target): LinkState => ({ target })),
    Effect.catchTags({
      PlatformError: (cause) =>
        Effect.succeed<LinkState>(isNotSymlinkError(cause) ? "not-symlink" : "missing"),
    }),
  );

/** Symlink `link` -> `target`, fixing stale links and leaving real entries alone. */
const ensureSymlink = Effect.fn("CursorHome.ensureSymlink")(function* (
  fileSystem: FileSystem.FileSystem,
  target: string,
  link: string,
) {
  const state = yield* readLinkState(fileSystem, link);
  if (state === "not-symlink") return; // real entry the user placed — respect it
  if (state !== "missing" && state.target === target) return;
  if (state !== "missing") {
    yield* fileSystem.remove(link).pipe(Effect.ignore);
  }
  yield* fileSystem.symlink(target, link).pipe(Effect.ignore);
});

/** Ensure `dirPath` exists as a real directory, never a symlink. */
const ensureRealDirectory = Effect.fn("CursorHome.ensureRealDirectory")(function* (
  fileSystem: FileSystem.FileSystem,
  dirPath: string,
) {
  const state = yield* readLinkState(fileSystem, dirPath);
  if (state !== "not-symlink" && state !== "missing") {
    yield* fileSystem.remove(dirPath).pipe(Effect.ignore);
  }
  yield* fileSystem.makeDirectory(dirPath, { recursive: true }).pipe(Effect.ignore);
});

/**
 * Materialize the instance's `homePath` as a shadow home directory and keep
 * its symlinks in sync with the real home. Re-runs on every instance start so
 * entries added to the real home later still resolve.
 */
export const materializeCursorShadowHome = Effect.fn("materializeCursorShadowHome")(function* (
  config: Pick<CursorSettings, "homePath">,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shadowHome = yield* resolveProviderHomePath(config.homePath);
  if (shadowHome === undefined) return;
  const realHome = NodeOS.homedir();
  if (shadowHome === realHome) {
    return yield* new CursorShadowHomeError({
      homePath: shadowHome,
      detail: "must differ from the real home directory",
    });
  }

  yield* ensureRealDirectory(fileSystem, shadowHome);
  const privateDirs = [
    path.join(shadowHome, ".cursor"),
    path.join(shadowHome, ".config"),
    path.join(shadowHome, ".config", "cursor"),
  ];
  yield* Effect.forEach(privateDirs, (dir) => ensureRealDirectory(fileSystem, dir), {
    discard: true,
  });
  // A private dir that still resolves through a symlink would share the real
  // account's credentials — fail rather than present broken isolation.
  yield* Effect.forEach(
    privateDirs,
    (dir) =>
      Effect.flatMap(readLinkState(fileSystem, dir), (state) =>
        state === "missing" || state === "not-symlink"
          ? Effect.void
          : new CursorShadowHomeError({
              homePath: shadowHome,
              detail: `'${dir}' must be a real directory, not a symlink`,
            }),
      ),
    { discard: true },
  );

  const linkMissing = (entries: ReadonlyArray<string>, targetDir: string, linkDir: string) =>
    Effect.forEach(
      entries,
      (entryName) =>
        ensureSymlink(fileSystem, path.join(targetDir, entryName), path.join(linkDir, entryName)),
      { discard: true },
    );

  const homeEntries = yield* fileSystem
    .readDirectory(realHome)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  yield* linkMissing(
    homeEntries.filter(
      (entryName) =>
        !PRIVATE_ENTRY_NAMES.has(entryName) &&
        // Never link the shadow home into itself (directly or via an ancestor).
        path.join(realHome, entryName) !== shadowHome &&
        !shadowHome.startsWith(path.join(realHome, entryName) + path.sep),
    ),
    realHome,
    shadowHome,
  );

  const configEntries = yield* fileSystem
    .readDirectory(path.join(realHome, ".config"))
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  yield* linkMissing(
    configEntries.filter((entryName) => !PRIVATE_CONFIG_ENTRY_NAMES.has(entryName)),
    path.join(realHome, ".config"),
    path.join(shadowHome, ".config"),
  );
});

/**
 * Merge the instance's `homePath` into the spawned environment as a shadow
 * `HOME`. Cursor's login, config, sessions, and usage-limit credentials then
 * all resolve inside the instance directory. A configured `homePath` wins
 * over an inherited `HOME` value.
 *
 * `AGENT_CLI_CREDENTIAL_STORE=file` is defaulted on so `cursor-agent login`
 * writes `auth.json` under the shadow home; the shared macOS keychain entry
 * would otherwise remain reachable through the symlinked `~/Library`.
 */
export const makeCursorEnvironment = Effect.fn("makeCursorEnvironment")(function* (
  config: Pick<CursorSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const shadowHome = yield* resolveProviderHomePath(config.homePath);
  if (shadowHome === undefined) return resolvedBaseEnv;
  return {
    AGENT_CLI_CREDENTIAL_STORE: "file",
    ...resolvedBaseEnv,
    HOME: shadowHome,
  };
});
