/**
 * DevinAdapterV2 — the dedicated `devin` driver's ACP flavor.
 *
 * Devin also runs generically through the ACP Registry; this flavor shares
 * that path's Devin protocol handling (`DevinAcp.ts`: subagent markers,
 * message grouping, tool names) and client-owned terminals, and adds what the
 * dedicated driver configures: the instance's binary, `--permission-mode` and
 * private `XDG_DATA_HOME`, grouped model variants from `devinModelCatalog`,
 * runtime-mode → session-mode mapping, `$skill` dispatch, and context windows.
 *
 * @module DevinAdapterV2
 */
import {
  type DevinSettings,
  type ModelSelection,
  ProviderDriverKind,
  type ProviderInstanceId,
  type OrchestrationV2ProviderCapabilities,
} from "@t3tools/contracts";
import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Scope from "effect/Scope";
import type { ChildProcessSpawner } from "effect/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import type * as ServerConfig from "../../config.ts";
import type * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
import {
  applyDevinAcpModelSelection,
  DEVIN_ACP_CLIENT_CAPABILITIES_META,
  makeDevinAcpRuntime,
  resolveDevinModeId,
} from "../../provider/acp/DevinAcpSupport.ts";
import {
  DEVIN_CONTEXT_OPTION_ID,
  inferDevinContextWindowTokens,
} from "../../provider/devinModelCatalog.ts";
import {
  hasCandidateSkillMention,
  planDevinSkillDispatch,
} from "../../provider/Drivers/DevinSkillDispatch.ts";
import type * as IdAllocator from "../IdAllocator.ts";
import type * as ProviderAdapter from "../ProviderAdapter.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "./AcpAdapterV2.ts";
import {
  extractDevinSubagentUpdate,
  normalizeDevinSessionUpdate,
  normalizeDevinToolCall,
} from "./DevinAcp.ts";

export const DEVIN_PROVIDER = ProviderDriverKind.make("devin");

export const DevinProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
    exposesSubagentThreadIds: true,
    emitsSubagentLifecycle: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface DevinAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly settings: Pick<DevinSettings, "binaryPath">;
  /** The instance's process environment, including its private `XDG_DATA_HOME`. */
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly crypto: Crypto.Crypto;
  readonly fileSystem: FileSystem.FileSystem;
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly serverConfig: ServerConfig.ServerConfig["Service"];
  readonly selfInvocation: SelfInvocation;
  /** Enabled, user-invocable skill names for a workspace (`devin skills list`). */
  readonly skillNames: (cwd: string) => Effect.Effect<ReadonlySet<string>>;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
}

/**
 * The context window for a grouped Devin selection: the 1M context variant
 * when selected, else the family's known window.
 */
export function devinModelContextWindow(selection: ModelSelection): number | undefined {
  const context = selection.options?.find((option) => option.id === DEVIN_CONTEXT_OPTION_ID);
  if (context?.value === "1m") return 1_000_000;
  return inferDevinContextWindowTokens(selection.model);
}

/**
 * Rewrites known `$skill` mentions to Devin's `@skills:name`. Discovery only
 * runs when the prompt has a candidate token; failures send the text as is.
 */
export function dispatchDevinSkills(input: {
  readonly text: string;
  readonly cwd: string | null;
  readonly skillNames: (cwd: string) => Effect.Effect<ReadonlySet<string>>;
}): Effect.Effect<string> {
  if (input.cwd === null || !hasCandidateSkillMention(input.text)) {
    return Effect.succeed(input.text);
  }
  return input
    .skillNames(input.cwd)
    .pipe(Effect.map((names) => planDevinSkillDispatch(input.text, names)?.prompt ?? input.text));
}

export function makeDevinAcpAdapterFlavor(options: DevinAdapterV2Options): AcpAdapterV2Flavor {
  return {
    driver: DEVIN_PROVIDER,
    runtimeHarness: "Devin",
    capabilities: DevinProviderCapabilitiesV2,
    clientCapabilitiesMeta: DEVIN_ACP_CLIENT_CAPABILITIES_META,
    normalizeSessionUpdate: normalizeDevinSessionUpdate,
    normalizeToolCall: normalizeDevinToolCall,
    extractSubagentUpdate: extractDevinSubagentUpdate,
    makeRuntime:
      options.makeRuntime ??
      (({ runtimePolicy, processEnvironment, ...input }) =>
        makeDevinAcpRuntime({
          ...input,
          devinSettings: options.settings,
          environment:
            processEnvironment === undefined
              ? options.environment
              : { ...options.environment, ...processEnvironment },
          childProcessSpawner: options.childProcessSpawner,
          runtimeMode: runtimePolicy.runtimeMode,
        })),
    applyModelSelection: ({ runtime, modelSelection }) =>
      applyDevinAcpModelSelection({
        runtime,
        model: modelSelection.model,
        selections: modelSelection.options,
        mapError: (cause) => cause,
      }),
    // Plan turns keep the build mode; the shared adapter switches to `plan`
    // on top of it and restores the build mode afterwards.
    sessionModeForPolicy: (policy, modeState) =>
      policy.interactionMode === "plan"
        ? undefined
        : resolveDevinModeId({ runtimeMode: policy.runtimeMode, modeState }),
    transformPromptText: ({ text, cwd }) =>
      dispatchDevinSkills({ text, cwd, skillNames: options.skillNames }),
  };
}

export function makeDevinAdapterV2(
  options: DevinAdapterV2Options,
): ProviderAdapter.ProviderAdapterV2Shape {
  const adapter = makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeDevinAcpAdapterFlavor(options),
    crypto: options.crypto,
    fileSystem: options.fileSystem,
    idAllocator: options.idAllocator,
    serverConfig: options.serverConfig,
    selfInvocation: options.selfInvocation,
    // Same ownership as Devin through the ACP Registry: Devin runs commands
    // through client terminals, so T3 streams their output and owns the
    // process tree on interrupt, with the instance's environment.
    clientTerminals: {
      childProcessSpawner: options.childProcessSpawner,
      environment: options.environment,
      shellCommands: true,
    },
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
  return {
    ...adapter,
    openSession: (input) =>
      adapter.openSession(input).pipe(
        Effect.map((session) => ({
          ...session,
          getModelContextWindow: devinModelContextWindow,
        })),
      ),
  };
}
