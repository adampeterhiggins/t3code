import { describe, expect, it } from "vite-plus/test";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  customAcpModelsFromSession,
  customAcpSupportsPlanMode,
  parseCustomAcpArguments,
  resolveCustomAcpConfigUpdates,
  resolveCustomAcpModeId,
  resolveCustomAcpSessionModel,
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
      group: "levels",
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
  it("shows the plan toggle only for agents with a plan-like mode", () => {
    expect(customAcpSupportsPlanMode({ sessionId: "s", modes: claudeModes })).toBe(true);
    expect(
      customAcpSupportsPlanMode({
        sessionId: "s",
        modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
      }),
    ).toBe(false);
    expect(customAcpSupportsPlanMode({ sessionId: "s" })).toBe(false);
  });
});

describe("resolveCustomAcpModeId", () => {
  const resolve = (
    runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access",
    interactionMode?: "plan" | "default",
    currentModeId = "default",
  ) =>
    resolveCustomAcpModeId({
      runtimeMode,
      interactionMode,
      modeState: { ...claudeModes, currentModeId },
    });

  it("maps runtime modes onto the agent's matching modes", () => {
    expect(resolve("approval-required")).toBe("default");
    expect(resolve("auto-accept-edits")).toBe("acceptEdits");
    expect(resolve("full-access")).toBe("bypassPermissions");
    expect(resolve("auto-accept-edits", "plan")).toBe("plan");
  });

  it("leaves the mode alone when nothing matches, unless leaving plan mode", () => {
    expect(resolve("auto")).toBeUndefined();
    expect(resolve("auto", "default", "plan")).toBe("default");
  });

  it("does nothing for agents without modes", () => {
    expect(
      resolveCustomAcpModeId({
        runtimeMode: "full-access",
        interactionMode: "plan",
        modeState: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("resolveCustomAcpConfigUpdates", () => {
  it("writes only advertised values that differ from the current ones", () => {
    expect(
      resolveCustomAcpConfigUpdates({
        configOptions: [modelOption, effortOption, thinkingOption, modeOption],
        model: "opus",
        selections: [
          { id: "effort", value: "high" },
          { id: "thinking", value: true },
          { id: "effort", value: "extreme" },
          { id: "unknown", value: "x" },
          { id: "mode", value: "default" },
        ],
      }),
    ).toEqual([
      { configId: "model", value: "opus" },
      { configId: "effort", value: "high" },
      { configId: "thinking", value: true },
    ]);
  });

  it("does not send models the agent did not advertise", () => {
    expect(
      resolveCustomAcpConfigUpdates({
        configOptions: [modelOption],
        model: "default",
        selections: undefined,
      }),
    ).toEqual([]);
  });
});

describe("resolveCustomAcpSessionModel", () => {
  const models = {
    currentModelId: "gemini-pro",
    availableModels: [
      { modelId: "gemini-flash", name: "Gemini Flash" },
      { modelId: "gemini-pro", name: "Gemini Pro" },
    ],
  };

  it("uses session/set_model only when there is no model config option", () => {
    expect(
      resolveCustomAcpSessionModel({
        configOptions: [],
        models,
        currentModelId: "gemini-pro",
        model: "gemini-flash",
      }),
    ).toBe("gemini-flash");
    expect(
      resolveCustomAcpSessionModel({
        configOptions: [modelOption],
        models,
        currentModelId: "gemini-pro",
        model: "gemini-flash",
      }),
    ).toBeUndefined();
    expect(
      resolveCustomAcpSessionModel({
        configOptions: [],
        models,
        currentModelId: "gemini-pro",
        model: "default",
      }),
    ).toBeUndefined();
  });
});
