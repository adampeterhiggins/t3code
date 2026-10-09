/**
 * CustomAcpAdapterV2 — the `customAcp` driver's ACP flavor: any stdio agent
 * from an executable, arguments, and the instance environment.
 *
 * The flavor only knows the ACP spec. Models, options, and modes come from
 * what the agent advertises; T3's MCP tools, approvals, elicitations, and auth
 * methods come from the shared ACP adapter.
 *
 * @module CustomAcpAdapterV2
 */
import type { CustomAcpSettings, ProviderInstanceId } from "@t3tools/contracts";
import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { ChildProcessSpawner } from "effect/process";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  CUSTOM_ACP_DRIVER_KIND,
  makeCustomAcpRuntime,
  resolveCustomAcpModeId,
  resolveCustomAcpModelUpdate,
} from "../../provider/acp/CustomAcpSupport.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";

export interface CustomAcpAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly settings: Pick<CustomAcpSettings, "binaryPath" | "arguments">;
  /** Shown to the agent as the harness it runs in. */
  readonly harness: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly selfInvocation: SelfInvocation;
  /** Slash commands the agent advertised for a workspace. */
  readonly onAvailableCommands: (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
}

export function makeCustomAcpAdapterFlavor(options: CustomAcpAdapterV2Options): AcpAdapterV2Flavor {
  return {
    driver: CUSTOM_ACP_DRIVER_KIND,
    runtimeHarness: options.harness,
    capabilities: AcpProviderCapabilitiesV2,
    makeRuntime:
      options.makeRuntime ??
      (({ runtimePolicy: _runtimePolicy, processEnvironment, ...input }) =>
        makeCustomAcpRuntime({
          ...input,
          settings: options.settings,
          environment:
            processEnvironment === undefined
              ? options.environment
              : { ...options.environment, ...processEnvironment },
          childProcessSpawner: options.childProcessSpawner,
        })),
    applyModelSelection: ({ runtime, startResult, modelSelection }) =>
      Effect.gen(function* () {
        const configOptions = yield* runtime.getConfigOptions;
        const update = resolveCustomAcpModelUpdate({
          configOptions,
          models: startResult.sessionSetupResult.models,
          model: modelSelection.model,
        });
        if (update?.type === "config") {
          yield* runtime.setConfigOption(update.configId, update.value);
          return update.value;
        }
        if (update?.type === "session") {
          yield* runtime.setSessionModel(update.modelId);
          return update.modelId;
        }
        return undefined;
      }),
    sessionModeForPolicy: (policy, modeState) =>
      policy.interactionMode === "plan"
        ? undefined
        : resolveCustomAcpModeId({ runtimeMode: policy.runtimeMode, modeState }),
    onAvailableCommandsUpdate: options.onAvailableCommands,
  };
}

export function makeCustomAcpAdapterV2(options: CustomAcpAdapterV2Options) {
  return makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeCustomAcpAdapterFlavor(options),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
}
