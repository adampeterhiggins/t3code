import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  mergeProviderHomePathEnvironment,
  mergeProviderInstanceEnvironment,
  resolveInstanceHomePath,
} from "./ProviderInstanceEnvironment.ts";

describe("mergeProviderInstanceEnvironment", () => {
  it.effect.each([
    { value: "~/.account", tail: ".account" },
    { value: "~\\.account\\work", tail: ".account\\work" },
  ])("expands configured provider homes set to $value", ({ value, tail }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const baseEnv = {
        CODEX_HOME: "~/.inherited-codex",
        CLAUDE_CONFIG_DIR: "~/.inherited-claude",
      };
      const environment = mergeProviderInstanceEnvironment(
        [
          { name: "CODEX_HOME", value, sensitive: false },
          { name: "CLAUDE_CONFIG_DIR", value, sensitive: false },
          { name: "CURSOR_CONFIG_DIR", value, sensitive: false },
          { name: "GROK_HOME", value, sensitive: false },
          { name: "XDG_DATA_HOME", value, sensitive: false },
          { name: "XDG_CONFIG_HOME", value, sensitive: false },
          { name: "CUSTOM_VALUE", value, sensitive: false },
        ],
        baseEnv,
      );

      expect(environment).toEqual({
        CODEX_HOME: path.join(NodeOS.homedir(), tail),
        CLAUDE_CONFIG_DIR: path.join(NodeOS.homedir(), tail),
        CURSOR_CONFIG_DIR: path.join(NodeOS.homedir(), tail),
        GROK_HOME: path.join(NodeOS.homedir(), tail),
        XDG_DATA_HOME: path.join(NodeOS.homedir(), tail),
        XDG_CONFIG_HOME: path.join(NodeOS.homedir(), tail),
        CUSTOM_VALUE: value,
      });
      expect(baseEnv).toEqual({
        CODEX_HOME: "~/.inherited-codex",
        CLAUDE_CONFIG_DIR: "~/.inherited-claude",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("leaves inherited provider homes unchanged", () => {
    const baseEnv = { CODEX_HOME: "~/.codex", CLAUDE_CONFIG_DIR: "~\\.claude" };

    expect(
      mergeProviderInstanceEnvironment(
        [{ name: "CUSTOM_VALUE", value: "~/.custom", sensitive: false }],
        baseEnv,
      ),
    ).toEqual({ ...baseEnv, CUSTOM_VALUE: "~/.custom" });
  });

  it("overrides inherited environment values and preserves empty strings", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [
          { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
        ],
        { ANTHROPIC_API_KEY: "inherited", PATH: "/bin" },
      ),
    ).toMatchObject({
      OPENROUTER_API_KEY: "sk-or-test",
      ANTHROPIC_API_KEY: "",
      PATH: "/bin",
    });
  });
});

describe("mergeProviderHomePathEnvironment", () => {
  it.effect("leaves the environment untouched when homePath is empty", () =>
    Effect.gen(function* () {
      const baseEnv = { KEEP: "1" };
      expect(yield* mergeProviderHomePathEnvironment("", ["GROK_HOME"], baseEnv)).toBe(baseEnv);
      expect(yield* mergeProviderHomePathEnvironment("   ", ["GROK_HOME"], baseEnv)).toBe(baseEnv);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("points each variable at the resolved homePath", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resolved = path.join(NodeOS.homedir(), ".xdg-work");

      const environment = yield* mergeProviderHomePathEnvironment(
        "~/.xdg-work",
        ["XDG_DATA_HOME", "XDG_CONFIG_HOME"],
        { KEEP: "1" },
      );

      expect(environment.XDG_DATA_HOME).toBe(resolved);
      expect(environment.XDG_CONFIG_HOME).toBe(resolved);
      expect(environment.KEEP).toBe("1");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("prefers the configured homePath over an inherited variable", () =>
    Effect.gen(function* () {
      const environment = yield* mergeProviderHomePathEnvironment("~/.grok-work", ["GROK_HOME"], {
        GROK_HOME: "/elsewhere/grok",
      });

      expect(environment.GROK_HOME).toBe((yield* Path.Path).join(NodeOS.homedir(), ".grok-work"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("resolveInstanceHomePath", () => {
  const cursor = ProviderDriverKind.make("cursor");
  const resolve = (
    stateDir: string,
    instanceId: string,
    options: { homePath?: string; environment?: { name: string; value: string }[] } = {},
  ) =>
    resolveInstanceHomePath({
      homePath: options.homePath ?? "",
      stateDir,
      driver: cursor,
      instanceId: ProviderInstanceId.make(instanceId),
      environment: options.environment?.map((variable) => ({ ...variable, sensitive: false })),
      homeVariables: ["HOME"],
    });

  it.effect("gives each added instance its own home and leaves the default instance alone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "instance-home-" });

      expect(yield* resolve(stateDir, "cursor")).toBe("");
      const work = yield* resolve(stateDir, "cursor_work");
      const personal = yield* resolve(stateDir, "cursor_personal");
      expect(work).not.toBe(personal);
      expect(work.startsWith(stateDir)).toBe(true);
      expect((yield* fileSystem.stat(work)).type).toBe("Directory");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a configured home or an environment variable that picks one", () =>
    Effect.gen(function* () {
      expect(yield* resolve("/state", "cursor_work", { homePath: "~/.cursor-work" })).toBe(
        "~/.cursor-work",
      );
      expect(
        yield* resolve("/state", "cursor_work", {
          environment: [{ name: "HOME", value: "/elsewhere" }],
        }),
      ).toBe("");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
