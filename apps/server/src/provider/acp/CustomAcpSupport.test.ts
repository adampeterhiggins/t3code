import { describe, expect, it } from "vite-plus/test";
import type * as EffectAcpSchema from "effect-acp/compat";

import {
  customAcpModelsFromSession,
  customAcpSupportsPlanMode,
  parseCustomAcpArguments,
  resolveCustomAcpModeId,
  resolveCustomAcpModelUpdate,
} from "./CustomAcpSupport.ts";

const modelOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "sonnet",
  options: [
    { value: "sonnet", name: "Sonnet" },
    { value: "opus", name: "Opus" },
  ],
} satisfies EffectAcpSchema.SessionConfigOption;

const effortOption = {
  id: "effort",
  name: "Effort",
  category: "thought_level",
  type: "select",
  currentValue: "medium",
  options: [
    {
      groupId: "levels",
      name: "Levels",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  ],
} satisfies EffectAcpSchema.SessionConfigOption;

const thinkingOption = {
  id: "thinking",
  name: "Thinking",
  type: "boolean",
  currentValue: false,
} satisfies EffectAcpSchema.SessionConfigOption;

const modeOption = {
  id: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "default",
  options: [{ value: "default", name: "Default" }],
} satisfies EffectAcpSchema.SessionConfigOption;

// Claude Code's ACP modes.
const claudeModes = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "acceptEdits", name: "Accept Edits" },
    { id: "plan", name: "Plan Mode" },
    { id: "bypassPermissions", name: "Bypass Permissions" },
  ],
};

describe("parseCustomAcpArguments", () => {
  it("takes one argument per line and drops blank lines", () => {
    expect(parseCustomAcpArguments("--experimental-acp\n\n  --model  \r\nfast mode\n")).toEqual([
      "--experimental-acp",
      "--model",
      "fast mode",
    ]);
  });
});

describe("customAcpModelsFromSession", () => {
  it("lists the model config option and turns the other config options into model options", () => {
    const models = customAcpModelsFromSession({
      configOptions: [modelOption, effortOption, thinkingOption, modeOption],
    });

    expect(models.map((model) => [model.slug, model.name, model.isDefault ?? false])).toEqual([
      ["sonnet", "Sonnet", true],
      ["opus", "Opus", false],
    ]);
    expect(models[0]?.capabilities?.optionDescriptors).toEqual([
      {
        id: "effort",
        label: "Effort",
        type: "select",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium", isDefault: true },
          { id: "high", label: "High" },
        ],
        currentValue: "medium",
      },
      { id: "thinking", label: "Thinking", type: "boolean", currentValue: false },
    ]);
  });

  it("falls back to the session models state", () => {
    const models = customAcpModelsFromSession({
      models: {
        currentModelId: "gemini-pro",
        availableModels: [
          { modelId: "gemini-flash", name: "Gemini Flash" },
          { modelId: "gemini-pro", name: "Gemini Pro" },
        ],
      },
    });

    expect(models.map((model) => [model.slug, model.isDefault ?? false])).toEqual([
      ["gemini-flash", false],
      ["gemini-pro", true],
    ]);
    expect(models[0]?.capabilities?.optionDescriptors).toEqual([]);
  });

  it("offers one agent-default row when the agent advertises no models", () => {
    expect(customAcpModelsFromSession({})).toMatchObject([
      { slug: "default", name: "Agent default", isDefault: true },
    ]);
  });
});

describe("customAcpSupportsPlanMode", () => {
  it("shows the plan toggle only when the agent has a mode T3 can switch to", () => {
    expect(customAcpSupportsPlanMode({ sessionId: "s", modes: claudeModes })).toBe(true);
    expect(
      customAcpSupportsPlanMode({
        sessionId: "s",
        modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
      }),
    ).toBe(false);
    expect(
      customAcpSupportsPlanMode({
        sessionId: "s",
        configOptions: [
          { ...modeOption, options: [...modeOption.options, { value: "plan", name: "Plan" }] },
        ],
      }),
    ).toBe(true);
    expect(customAcpSupportsPlanMode({ sessionId: "s" })).toBe(false);
  });
});

describe("resolveCustomAcpModeId", () => {
  const resolve = (
    runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access",
    currentModeId = "default",
  ) => resolveCustomAcpModeId({ runtimeMode, modeState: { ...claudeModes, currentModeId } });

  it("maps runtime modes onto the agent's matching modes", () => {
    expect(resolve("approval-required", "acceptEdits")).toBe("default");
    expect(resolve("auto-accept-edits")).toBe("acceptEdits");
    expect(resolve("full-access")).toBe("bypassPermissions");
    expect(resolve("approval-required")).toBeUndefined();
  });

  it("leaves the mode alone when nothing matches, unless a plan mode is active", () => {
    expect(resolve("auto")).toBeUndefined();
    expect(resolve("auto", "plan")).toBe("default");
  });

  it("does nothing for agents without modes", () => {
    expect(
      resolveCustomAcpModeId({ runtimeMode: "full-access", modeState: undefined }),
    ).toBeUndefined();
  });
});

describe("resolveCustomAcpModelUpdate", () => {
  const models = {
    currentModelId: "gemini-pro",
    availableModels: [
      { modelId: "gemini-flash", name: "Gemini Flash" },
      { modelId: "gemini-pro", name: "Gemini Pro" },
    ],
  };

  it("switches through the model config option when the agent has one", () => {
    expect(
      resolveCustomAcpModelUpdate({ configOptions: [modelOption], models, model: "opus" }),
    ).toEqual({ type: "config", configId: "model", value: "opus" });
    expect(
      resolveCustomAcpModelUpdate({ configOptions: [modelOption], models, model: "gemini-flash" }),
    ).toBeUndefined();
  });

  it("falls back to session/set_model for agents with only models state", () => {
    expect(
      resolveCustomAcpModelUpdate({ configOptions: [], models, model: "gemini-flash" }),
    ).toEqual({ type: "session", modelId: "gemini-flash" });
  });

  it("sends nothing for the current model, the agent default, or an unknown model", () => {
    for (const model of ["gemini-pro", "default", "unknown"]) {
      expect(resolveCustomAcpModelUpdate({ configOptions: [], models, model })).toBeUndefined();
    }
    expect(
      resolveCustomAcpModelUpdate({ configOptions: [modelOption], models, model: "sonnet" }),
    ).toBeUndefined();
  });
});
