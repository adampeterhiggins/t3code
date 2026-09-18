import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveProviderHomePath } from "../ProviderInstanceEnvironment.ts";
import { makeCursorEnvironment, materializeCursorShadowHome } from "./CursorHome.ts";

it.layer(NodeServices.layer)("CursorHome", (it) => {
  describe("instance home environment", () => {
    it.effect("leaves the environment untouched when no home override is configured", () =>
      Effect.gen(function* () {
        expect(yield* resolveProviderHomePath("")).toBeUndefined();
        expect(yield* makeCursorEnvironment({ homePath: "" })).toBe(process.env);

        const baseEnv = { KEEP: "1" };
        expect(yield* makeCursorEnvironment({ homePath: "   " }, baseEnv)).toBe(baseEnv);
      }),
    );

    it.effect("points HOME at the resolved path and defaults to file credential storage", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".cursor-work");

        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { KEEP: "1" },
        );

        expect(yield* resolveProviderHomePath("~/.cursor-work")).toBe(resolved);
        expect(environment.HOME).toBe(resolved);
        expect(environment.AGENT_CLI_CREDENTIAL_STORE).toBe("file");
        expect(environment.KEEP).toBe("1");
      }),
    );

    it.effect("prefers the configured homePath over an inherited HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".cursor-work");

        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { HOME: "/elsewhere" },
        );

        expect(environment.HOME).toBe(resolved);
      }),
    );
  });

  describe("shadow home materialization", () => {
    const isSymlink = (fileSystem: FileSystem.FileSystem, linkPath: string) =>
      fileSystem.readLink(linkPath).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );

    it.effect("creates private .cursor and .config/cursor directories", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const shadowHome = yield* fs.makeTempDirectoryScoped({
          prefix: "t3-cursor-shadow-",
        });

        yield* materializeCursorShadowHome({ homePath: shadowHome });

        expect(yield* isSymlink(fs, path.join(shadowHome, ".cursor"))).toBe(false);
        expect(yield* fs.exists(path.join(shadowHome, ".cursor"))).toBe(true);
        expect(yield* isSymlink(fs, path.join(shadowHome, ".config"))).toBe(false);
        expect(yield* fs.exists(path.join(shadowHome, ".config", "cursor"))).toBe(true);
        expect(yield* isSymlink(fs, path.join(shadowHome, ".config", "cursor"))).toBe(false);
      }).pipe(Effect.scoped),
    );

    it.effect("links real home entries into the shadow home without linking .cursor", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const realHome = NodeOS.homedir();
        const shadowHome = yield* fs.makeTempDirectoryScoped({
          prefix: "t3-cursor-shadow-",
        });

        yield* materializeCursorShadowHome({ homePath: shadowHome });

        for (const entryName of yield* fs.readDirectory(realHome)) {
          if (entryName === ".cursor" || entryName === ".config") continue;
          const link = path.join(shadowHome, entryName);
          expect(yield* isSymlink(fs, link)).toBe(true);
          expect(yield* fs.readLink(link)).toBe(path.join(realHome, entryName));
        }
      }).pipe(Effect.scoped),
    );

    it.effect("keeps ~/.config shared except for the cursor entry", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const realConfig = path.join(NodeOS.homedir(), ".config");
        const shadowHome = yield* fs.makeTempDirectoryScoped({
          prefix: "t3-cursor-shadow-",
        });

        yield* materializeCursorShadowHome({ homePath: shadowHome });

        const shadowConfig = path.join(shadowHome, ".config");
        expect(yield* isSymlink(fs, shadowConfig)).toBe(false);
        for (const entryName of yield* fs
          .readDirectory(realConfig)
          .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))) {
          if (entryName === "cursor") continue;
          expect(yield* isSymlink(fs, path.join(shadowConfig, entryName))).toBe(true);
        }
        expect(yield* isSymlink(fs, path.join(shadowConfig, "cursor"))).toBe(false);
      }).pipe(Effect.scoped),
    );

    it.effect("rejects the real home directory as an instance home", () =>
      Effect.gen(function* () {
        const result = yield* materializeCursorShadowHome({
          homePath: NodeOS.homedir(),
        }).pipe(Effect.flip);
        expect(result._tag).toBe("CursorShadowHomeError");
      }),
    );
  });
});
