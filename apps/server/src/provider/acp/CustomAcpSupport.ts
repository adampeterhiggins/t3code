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
  type ProviderInteractionMode,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  ProviderDriverKind,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { buildBooleanOptionDescriptor, buildSelectOptionDescriptor } from "../providerSnapshot.ts";
import { findAcpModeByAliases } from "./AcpAdapterSupport.ts";
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

// T3 answers form elicitations as user-input questions; files and terminals
// stay with the agent.
const CUSTOM_ACP_CLIENT_CAPABILITIES = {
  elicitation: { form: {} },
} satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

interface CustomAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "clientCapabilities" | "spawn"
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
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildCustomAcpSpawnInput(input.settings, input.cwd, input.environment),
        clientCapabilities: CUSTOM_ACP_CLIENT_CAPABILITIES,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
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

const PLAN_MODE_ALIASES = ["plan", "architect"];
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

export function customAcpSupportsPlanMode(setup: CustomAcpSessionSetup): boolean {
  const modes = parseSessionModeState(setup)?.availableModes ?? [];
  return findAcpModeByAliases(modes, PLAN_MODE_ALIASES) !== undefined;
}

/**
 * The advertised mode that best matches T3's plan toggle and runtime mode.
 * Leaving plan mode falls back to an implementation mode. Undefined leaves
 * the agent's mode alone; permission requests still follow the runtime mode.
 */
export function resolveCustomAcpModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modes = input.modeState?.availableModes;
  if (!modes || modes.length === 0) return undefined;
  if (input.interactionMode === "plan") {
    return findAcpModeByAliases(modes, PLAN_MODE_ALIASES)?.id;
  }
  const isPlan = (mode: { readonly id: string; readonly name: string }) =>
    findAcpModeByAliases([mode], PLAN_MODE_ALIASES) !== undefined;
  const buildModes = modes.filter((mode) => !isPlan(mode));
  const matched = findAcpModeByAliases(buildModes, MODE_ALIASES_BY_RUNTIME_MODE[input.runtimeMode]);
  if (matched) return matched.id;
  const current = modes.find((mode) => mode.id === input.modeState?.currentModeId);
  if (current && !isPlan(current)) return undefined;
  return (findAcpModeByAliases(buildModes, IMPLEMENT_MODE_ALIASES) ?? buildModes[0])?.id;
}

interface CustomAcpConfigUpdate {
  readonly configId: string;
  readonly value: string | boolean;
}

/**
 * Config writes for a model selection: the model through the `model` config
 * option when there is one, then each option the user picked that names an
 * advertised config option and value. Current values are skipped.
 */
export function resolveCustomAcpConfigUpdates(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly model: string | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ReadonlyArray<CustomAcpConfigUpdate> {
  const updates: Array<CustomAcpConfigUpdate> = [];
  const modelOption = findModelConfigOption(input.configOptions);
  if (
    modelOption &&
    input.model !== undefined &&
    input.model !== modelOption.currentValue.trim() &&
    flattenSelectValues(modelOption).some((entry) => entry.value.trim() === input.model)
  ) {
    updates.push({ configId: modelOption.id, value: input.model });
  }
  for (const selection of input.selections ?? []) {
    const option = optionConfigOptions(input.configOptions).find(
      (candidate) => candidate.id.trim() === selection.id,
    );
    if (!option) continue;
    if (option.type === "boolean") {
      if (typeof selection.value === "boolean" && selection.value !== option.currentValue) {
        updates.push({ configId: option.id, value: selection.value });
      }
      continue;
    }
    if (
      typeof selection.value === "string" &&
      selection.value !== option.currentValue.trim() &&
      flattenSelectValues(option).some((entry) => entry.value.trim() === selection.value)
    ) {
      updates.push({ configId: option.id, value: selection.value });
    }
  }
  return updates;
}

/**
 * The model to send through `session/set_model`, for agents that advertise
 * `models` state but no `model` config option.
 */
export function resolveCustomAcpSessionModel(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly models: EffectAcpSchema.SessionModelState | null | undefined;
  readonly currentModelId: string | undefined;
  readonly model: string | undefined;
}): string | undefined {
  if (input.model === undefined || findModelConfigOption(input.configOptions)) return undefined;
  if (input.model === input.currentModelId) return undefined;
  return input.models?.availableModels.some((model) => model.modelId.trim() === input.model)
    ? input.model
    : undefined;
}
