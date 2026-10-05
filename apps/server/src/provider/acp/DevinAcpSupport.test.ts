import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/compat";

import type { AcpSessionModeState } from "./AcpRuntimeModel.ts";
import {
  applyDevinAcpModelSelection,
  buildDevinAcpSpawnInput,
  resolveDevinModeId,
} from "./DevinAcpSupport.ts";

describe("buildDevinAcpSpawnInput", () => {
  it("builds the default Devin ACP command", () => {
    assert.deepStrictEqual(buildDevinAcpSpawnInput(undefined, "/tmp/project"), {
      command: "devin",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("honors the configured binary path", () => {
    assert.deepStrictEqual(
      buildDevinAcpSpawnInput({ binaryPath: "/usr/local/bin/devin" }, "/tmp/project"),
      {
        command: "/usr/local/bin/devin",
        args: ["acp"],
        cwd: "/tmp/project",
      },
    );
  });

  it.each([
    ["approval-required", ["--permission-mode", "normal", "acp"]],
    ["auto-accept-edits", ["--permission-mode", "accept-edits", "acp"]],
    ["auto", ["--permission-mode", "smart", "acp"]],
    ["full-access", ["--permission-mode", "bypass", "acp"]],
  ] as const)("maps %s to %j", (runtimeMode, args) => {
    assert.deepStrictEqual(
      buildDevinAcpSpawnInput(undefined, "/tmp/project", undefined, runtimeMode).args,
      args,
    );
  });
});

const DEVIN_MODES: AcpSessionModeState["availableModes"] = [
  { id: "accept-edits", name: "Code" },
  { id: "smart", name: "Smart" },
  { id: "ask", name: "Ask" },
  { id: "plan", name: "Plan" },
  { id: "bypass", name: "Bypass Permissions" },
];

function modeState(currentModeId: string): AcpSessionModeState {
  return { currentModeId, availableModes: DEVIN_MODES };
}

describe("resolveDevinModeId", () => {
  it.each([
    ["auto-accept-edits", "smart", "accept-edits"],
    ["auto", "accept-edits", "smart"],
    ["full-access", "accept-edits", "bypass"],
  ] as const)("maps %s from %s to %s", (runtimeMode, current, expected) => {
    assert.strictEqual(
      resolveDevinModeId({ runtimeMode, modeState: modeState(current) }),
      expected,
    );
  });

  it("leaves a mode that already matches alone", () => {
    assert.isUndefined(
      resolveDevinModeId({ runtimeMode: "full-access", modeState: modeState("bypass") }),
    );
  });

  it("leaves approval-required untouched while a writable mode is active", () => {
    assert.isUndefined(
      resolveDevinModeId({
        runtimeMode: "approval-required",
        modeState: modeState("accept-edits"),
      }),
    );
  });

  it("escapes a read-only mode for approval-required after a plan turn", () => {
    assert.strictEqual(
      resolveDevinModeId({ runtimeMode: "approval-required", modeState: modeState("plan") }),
      "accept-edits",
    );
  });

  it("returns undefined when no mode state is known", () => {
    assert.isUndefined(resolveDevinModeId({ runtimeMode: "full-access", modeState: undefined }));
  });
});

const modelOption = (currentValue: string) =>
  ({
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [
      { value: "swe-1-7", name: "SWE 1.7" },
      { value: "swe-1-7-high", name: "SWE 1.7 High" },
      { value: "adaptive", name: "Adaptive" },
    ],
  }) satisfies EffectAcpSchema.SessionConfigOption;

describe("applyDevinAcpModelSelection", () => {
  const run = (input: {
    readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
    readonly model: string | undefined;
    readonly selections?: ReadonlyArray<{ readonly id: string; readonly value: string }>;
  }) =>
    Effect.gen(function* () {
      const sent: Array<string> = [];
      const applied = yield* applyDevinAcpModelSelection({
        runtime: {
          getConfigOptions: Effect.succeed(input.configOptions),
          setModel: (value: string) => Effect.sync(() => sent.push(value)),
        },
        model: input.model,
        selections: input.selections,
        mapError: (cause) => cause,
      });
      return { applied, sent };
    });

  it.effect("resolves the grouped effort option to the advertised variant uid", () =>
    Effect.gen(function* () {
      const result = yield* run({
        configOptions: [modelOption("adaptive")],
        model: "swe-1-7",
        selections: [{ id: "effort", value: "high" }],
      });
      assert.deepStrictEqual(result, { applied: "swe-1-7-high", sent: ["swe-1-7-high"] });
    }),
  );

  it.effect("skips set_model when the session already runs the model", () =>
    Effect.gen(function* () {
      const result = yield* run({ configOptions: [modelOption("swe-1-7")], model: "swe-1-7" });
      assert.deepStrictEqual(result, { applied: "swe-1-7", sent: [] });
    }),
  );

  it.effect("keeps the session's model when none is selected", () =>
    Effect.gen(function* () {
      const result = yield* run({ configOptions: [modelOption("adaptive")], model: undefined });
      assert.deepStrictEqual(result, { applied: "adaptive", sent: [] });
    }),
  );
});
