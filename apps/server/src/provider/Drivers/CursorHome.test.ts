import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { makeCursorEnvironment, resolveCursorConfigDir } from "./CursorHome.ts";

it.layer(NodeServices.layer)("CursorHome", (it) => {
  describe("Cursor config dir resolution", () => {
    it.effect("leaves the environment untouched when no home override is configured", () =>
      Effect.gen(function* () {
        expect(yield* resolveCursorConfigDir({ homePath: "" })).toBeUndefined();
        expect(yield* makeCursorEnvironment({ homePath: "" })).toBe(process.env);

        const baseEnv = { KEEP: "1" };
        expect(yield* makeCursorEnvironment({ homePath: "   " }, baseEnv)).toBe(baseEnv);
      }),
    );

    it.effect("points CURSOR_CONFIG_DIR at the resolved home and defaults to file storage", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".cursor-work");

        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { KEEP: "1" },
        );

        expect(yield* resolveCursorConfigDir({ homePath: "~/.cursor-work" })).toBe(resolved);
        expect(environment.CURSOR_CONFIG_DIR).toBe(resolved);
        expect(environment.AGENT_CLI_CREDENTIAL_STORE).toBe("file");
        expect(environment.KEEP).toBe("1");
      }),
    );

    it.effect("lets an explicit credential-store variable override the file default", () =>
      Effect.gen(function* () {
        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { AGENT_CLI_CREDENTIAL_STORE: "memory" },
        );

        expect(environment.AGENT_CLI_CREDENTIAL_STORE).toBe("memory");
      }),
    );

    it.effect("prefers the configured homePath over an environment CURSOR_CONFIG_DIR", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".cursor-work");

        const environment = yield* makeCursorEnvironment(
          { homePath: "~/.cursor-work" },
          { CURSOR_CONFIG_DIR: "/elsewhere/cursor" },
        );

        expect(environment.CURSOR_CONFIG_DIR).toBe(resolved);
      }),
    );
  });
});
