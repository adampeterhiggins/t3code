import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveProviderHomePath } from "@t3tools/provider-core/server/instanceEnvironment";
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
        const home = yield* HostProcess.HomeDirectory;
        const resolved = path.resolve(home, ".cursor-work");

        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { KEEP: "1", XDG_CONFIG_HOME: "/host/config" },
        );

        expect(yield* resolveProviderHomePath("~/.cursor-work")).toBe(resolved);
        expect(environment.HOME).toBe(resolved);
        expect(environment.USERPROFILE).toBe(resolved);
        expect(environment.XDG_CONFIG_HOME).toBe(path.join(resolved, ".config"));
        expect(environment.AGENT_CLI_CREDENTIAL_STORE).toBe("file");
        expect(environment.KEEP).toBe("1");
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, "/home/ada")),
    );

    it.effect("prefers the configured homePath over an inherited HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve("/home/ada", ".cursor-work");

        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { HOME: "/elsewhere" },
        );

        expect(environment.HOME).toBe(resolved);
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, "/home/ada")),
    );

    it.effect("keeps an explicit credential store from the instance environment", () =>
      Effect.gen(function* () {
        const environment = yield* makeCursorEnvironment(
          { homePath: "/instances/cursor" },
          { AGENT_CLI_CREDENTIAL_STORE: "keychain" },
        );

        expect(environment.AGENT_CLI_CREDENTIAL_STORE).toBe("keychain");
        expect(environment.HOME).toBe("/instances/cursor");
      }),
    );
  });

  describe("shadow home materialization", () => {
    const isSymlink = (fileSystem: FileSystem.FileSystem, linkPath: string) =>
      fileSystem.readLink(linkPath).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );

    const makeRealHome = Effect.fnUntraced(function* (fileSystem: FileSystem.FileSystem) {
      const path = yield* Path.Path;
      const realHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-cursor-real-" });
      yield* fileSystem.makeDirectory(path.join(realHome, ".cursor"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(realHome, ".config", "cursor"), {
        recursive: true,
      });
      yield* fileSystem.makeDirectory(path.join(realHome, ".config", "git"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(realHome, "notes.txt"), "keep");
      return realHome;
    });

    it.effect("creates private .cursor and .config/cursor directories", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const realHome = yield* makeRealHome(fs);
        const shadowHome = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-shadow-" });

        yield* materializeCursorShadowHome({ homePath: shadowHome }).pipe(
          Effect.provideService(HostProcess.HomeDirectory, realHome),
        );

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
        const realHome = yield* makeRealHome(fs);
        const shadowHome = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-shadow-" });

        yield* materializeCursorShadowHome({ homePath: shadowHome }).pipe(
          Effect.provideService(HostProcess.HomeDirectory, realHome),
        );

        expect(yield* isSymlink(fs, path.join(shadowHome, "notes.txt"))).toBe(true);
        expect(yield* fs.readLink(path.join(shadowHome, "notes.txt"))).toBe(
          path.join(realHome, "notes.txt"),
        );
        expect(yield* isSymlink(fs, path.join(shadowHome, ".cursor"))).toBe(false);
        expect(yield* isSymlink(fs, path.join(shadowHome, ".config", "git"))).toBe(true);
        expect(yield* fs.readLink(path.join(shadowHome, ".config", "git"))).toBe(
          path.join(realHome, ".config", "git"),
        );
        expect(yield* isSymlink(fs, path.join(shadowHome, ".config", "cursor"))).toBe(false);
      }).pipe(Effect.scoped),
    );

    it.effect("rejects the real home directory as an instance home", () =>
      Effect.gen(function* () {
        const realHome = "/home/ada";
        const result = yield* materializeCursorShadowHome({ homePath: realHome }).pipe(
          Effect.provideService(HostProcess.HomeDirectory, realHome),
          Effect.flip,
        );
        expect(result._tag).toBe("CursorShadowHomeError");
      }),
    );
  });
});
