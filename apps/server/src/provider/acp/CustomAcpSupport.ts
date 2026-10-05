/**
 * CustomAcpSupport — spawn input and capability mapping for user-configured
 * ACP agents.
 *
 * Nothing here knows a particular agent. Models, options, and modes are read
 * from what the agent advertises in its session setup response, and T3's
 * selections are only sent back when they name something it advertised.
 *
 * @module CustomAcpSupport
 */
import {
  CUSTOM_ACP_DEFAULT_MODEL,
  type CustomAcpSettings,
  type ModelCapabilities,
  type ProviderOptionDescriptor,
  ProviderDriverKind,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import { buildBooleanOptionDescriptor, buildSelectOptionDescriptor } from "../providerSnapshot.ts";
import { findAcpModeByAliases } from "./AcpModeAliases.ts";
import { type AcpSessionModeState, parseSessionModeState } from "./AcpRuntimeModel.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

export const CUSTOM_ACP_DRIVER_KIND = ProviderDriverKind.make("customAcp");

export type CustomAcpSessionSetup =
  | EffectAcpSchema.LoadSessionResponse
  | EffectAcpSchema.NewSessionResponse
  | EffectAcpSchema.ResumeSessionResponse;

/** One argument per line, so arguments may contain spaces without quoting rules. */
export function parseCustomAcpArguments(value: string): ReadonlyArray<string> {
  return value
    .split(/\r?\n/u)
    .map((argument) => argument.trim())
    .filter((argument) => argument.length > 0);
}

export function buildCustomAcpSpawnInput(
  settings: Pick<CustomAcpSettings, "binaryPath" | "arguments">,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: settings.binaryPath,
    args: parseCustomAcpArguments(settings.arguments),
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export interface CustomAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly settings: Pick<CustomAcpSettings, "binaryPath" | "arguments">;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeCustomAcpRuntime = (
  input: CustomAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const { childProcessSpawner, settings, environment, ...options } = input;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...options,
        spawn: buildCustomAcpSpawnInput(settings, input.cwd, environment),
        // Files and terminals stay with the agent.
        clientCapabilities: options.clientCapabilities ?? { elicitation: { form: {} } },
      }).pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner)),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

function isModelConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  return option.category === "model" || option.id.trim() === "model";
}

function isModeConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  return option.category === "mode" || option.id.trim() === "mode";
}

function flattenSelectValues(
  option: Extract<EffectAcpSchema.SessionConfigOption, { readonly type: "select" }>,
): ReadonlyArray<EffectAcpSchema.SessionConfigSelectOption> {
  return option.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
}

function findModelConfigOption(configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>) {
  const option = configOptions.find(isModelConfigOption);
  return option?.type === "select" ? option : undefined;
}

/** Config options T3 renders as model options: everything but the model and mode selectors. */
function optionConfigOptions(configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>) {
  return configOptions.filter(
    (option) => !isModelConfigOption(option) && !isModeConfigOption(option),
  );
}

function optionDescriptorFromConfigOption(
  option: EffectAcpSchema.SessionConfigOption,
): ProviderOptionDescriptor | undefined {
  const id = option.id.trim();
  const label = option.name.trim() || id;
  const description = option.description?.trim() || undefined;
  if (!id) return undefined;
  if (option.type === "boolean") {
    return buildBooleanOptionDescriptor({
      id,
      label,
      currentValue: option.currentValue,
      ...(description ? { description } : {}),
    });
  }
  const current = option.currentValue.trim();
  const choices = flattenSelectValues(option).flatMap((entry) => {
    const value = entry.value.trim();
    if (!value) return [];
    const choiceDescription = entry.description?.trim() || undefined;
    return [
      {
        value,
        label: entry.name.trim() || value,
        ...(choiceDescription ? { description: choiceDescription } : {}),
        ...(value === current ? { isDefault: true } : {}),
      },
    ];
  });
  if (choices.length === 0) return undefined;
  return buildSelectOptionDescriptor({
    id,
    label,
    options: choices,
    ...(description ? { description } : {}),
  });
}

function customAcpModelCapabilities(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): ModelCapabilities {
  return createModelCapabilities({
    optionDescriptors: optionConfigOptions(configOptions).flatMap(
      (option) => optionDescriptorFromConfigOption(option) ?? [],
    ),
  });
}

/**
 * Model rows for the picker. A `model` config option wins over the unstable
 * `models` state; an agent that advertises neither gets one row that keeps
 * whatever model it runs by default. Every row shares the session's other
 * config options, since agents report them per session rather than per model.
 */
export function customAcpModelsFromSession(
  setup: Pick<CustomAcpSessionSetup, "configOptions" | "models">,
): ReadonlyArray<ServerProviderModel> {
  const configOptions = setup.configOptions ?? [];
  const capabilities = customAcpModelCapabilities(configOptions);
  const modelOption = findModelConfigOption(configOptions);
  const advertised = modelOption
    ? {
        current: modelOption.currentValue.trim(),
        models: flattenSelectValues(modelOption).map((entry) => ({
          id: entry.value.trim(),
          name: entry.name.trim(),
        })),
      }
    : setup.models
      ? {
          current: setup.models.currentModelId.trim(),
          models: setup.models.availableModels.map((model) => ({
            id: model.modelId.trim(),
            name: model.name.trim(),
          })),
        }
      : undefined;
  const seen = new Set<string>();
  const models = (advertised?.models ?? []).flatMap((model): ServerProviderModel[] => {
    if (!model.id || seen.has(model.id)) return [];
    seen.add(model.id);
    return [
      {
        slug: model.id,
        name: model.name || model.id,
        isCustom: false,
        ...(model.id === advertised?.current ? { isDefault: true } : {}),
        capabilities,
      },
    ];
  });
  if (models.length > 0) return models;
  return [
    {
      slug: CUSTOM_ACP_DEFAULT_MODEL,
      name: "Agent default",
      isCustom: false,
      isDefault: true,
      capabilities,
    },
  ];
}

// The plan ids the shared ACP adapter switches to for T3's plan toggle.
const PLAN_MODE_IDS = new Set(["plan", "architect"]);

/**
 * Whether T3's plan toggle can drive this agent: it advertises a `plan` or
 * `architect` session mode, or a mode config option with that choice.
 */
export function customAcpSupportsPlanMode(setup: CustomAcpSessionSetup): boolean {
  const modes = parseSessionModeState(setup)?.availableModes ?? [];
  if (modes.some((mode) => PLAN_MODE_IDS.has(mode.id))) return true;
  return (setup.configOptions ?? []).some(
    (option) =>
      option.type === "select" &&
      (option.category === "mode" || option.category === "collaboration_mode") &&
      flattenSelectValues(option).some((entry) => PLAN_MODE_IDS.has(entry.value)),
  );
}

// First advertised match wins. The names cover the common agents: Claude Code
// (default, acceptEdits, bypassPermissions), Gemini CLI (default, autoEdit,
// yolo), and Cursor-style (ask, code, agent).
const MODE_ALIASES_BY_RUNTIME_MODE: Record<RuntimeMode, ReadonlyArray<string>> = {
  "approval-required": ["default", "ask", "normal"],
  "auto-accept-edits": ["acceptEdits", "accept-edits", "autoEdit", "auto_edit", "auto-edit"],
  auto: ["auto", "smart"],
  "full-access": ["bypassPermissions", "bypass", "yolo", "full-access", "fullAccess"],
};
const IMPLEMENT_MODE_ALIASES = ["code", "agent", "default", "implement", "chat"];

/**
 * The advertised build mode that best matches T3's runtime mode. A plan mode
 * left active falls back to an implementation mode. Undefined leaves the
 * agent's mode alone; permission requests still follow the runtime mode.
 * The shared ACP adapter switches plan mode on top of this.
 */
export function resolveCustomAcpModeId(input: {
  readonly runtimeMode: RuntimeMode;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modes = input.modeState?.availableModes;
  if (!modes || modes.length === 0) return undefined;
  const buildModes = modes.filter((mode) => !PLAN_MODE_IDS.has(mode.id));
  const current = input.modeState?.currentModeId;
  const matched = findAcpModeByAliases(buildModes, MODE_ALIASES_BY_RUNTIME_MODE[input.runtimeMode]);
  const resolved =
    matched?.id ??
    (current !== undefined && !PLAN_MODE_IDS.has(current)
      ? undefined
      : (findAcpModeByAliases(buildModes, IMPLEMENT_MODE_ALIASES) ?? buildModes[0])?.id);
  return resolved === current ? undefined : resolved;
}

export type CustomAcpModelUpdate =
  | { readonly type: "config"; readonly configId: string; readonly value: string }
  | { readonly type: "session"; readonly modelId: string };

/**
 * How to switch to `model`: through the `model` config option when there is
 * one, else `session/set_model` for agents that advertise `models` state.
 * Undefined for the agent-default row, the current model, or a model the
 * agent did not advertise.
 */
export function resolveCustomAcpModelUpdate(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly models: EffectAcpSchema.SessionModelState | null | undefined;
  readonly model: string;
}): CustomAcpModelUpdate | undefined {
  if (input.model === CUSTOM_ACP_DEFAULT_MODEL) return undefined;
  const modelOption = findModelConfigOption(input.configOptions);
  if (modelOption) {
    return input.model !== modelOption.currentValue.trim() &&
      flattenSelectValues(modelOption).some((entry) => entry.value.trim() === input.model)
      ? { type: "config", configId: modelOption.id, value: input.model }
      : undefined;
  }
  return input.model !== input.models?.currentModelId &&
    input.models?.availableModels.some((model) => model.modelId.trim() === input.model) === true
    ? { type: "session", modelId: input.model }
    : undefined;
}
