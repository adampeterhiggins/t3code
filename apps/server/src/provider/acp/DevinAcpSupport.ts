/**
 * DevinAcpSupport — spawn and session helpers for `devin acp`.
 *
 * Devin's ACP server exposes a merged "Session Mode" selector (accept-edits,
 * smart, ask, plan, bypass) plus a `model` config option. The CLI's most
 * restrictive writable permission mode (`normal`) is not in that selector —
 * it is only reachable through the `--permission-mode` spawn flag, so T3's
 * "approval-required" maps to the flag at spawn and to `accept-edits` (the
 * least-privileged writable ACP mode) when the session mode must be restored
 * in-session.
 *
 * @module DevinAcpSupport
 */
import type { DevinSettings, ProviderOptionSelection, RuntimeMode } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import { findAcpModeByAliases } from "./AcpModeAliases.ts";
import { type AcpSessionModeState, collectSessionConfigOptionValues } from "./AcpRuntimeModel.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { resolveDevinModelUid } from "../devinModelCatalog.ts";

type DevinAcpRuntimeDevinSettings = Pick<DevinSettings, "binaryPath">;

/**
 * T3 runtime mode → Devin `--permission-mode`. `normal` auto-approves
 * read-only work and prompts for risky actions; `bypass` auto-approves all.
 */
function devinAcpPermissionArgs(runtimeMode?: RuntimeMode): ReadonlyArray<string> {
  switch (runtimeMode) {
    case "approval-required":
      return ["--permission-mode", "normal"];
    case "auto-accept-edits":
      return ["--permission-mode", "accept-edits"];
    case "auto":
      return ["--permission-mode", "smart"];
    case "full-access":
      return ["--permission-mode", "bypass"];
    default:
      return [];
  }
}

export function buildDevinAcpSpawnInput(
  devinSettings: DevinAcpRuntimeDevinSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: devinSettings?.binaryPath || "devin",
    args: [...devinAcpPermissionArgs(runtimeMode), "acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

/**
 * Devin's extension flags for runtimes T3 starts outside a chat session
 * (sign-in, text generation): subagent markers and streamed message grouping.
 * Chat sessions get the same flags from the adapter flavor.
 */
export const DEVIN_ACP_CLIENT_CAPABILITIES_META = {
  "cognition.ai/subagentSupport": true,
  "cognition.ai/messageGrouping": true,
} as const;

export interface DevinAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly devinSettings: DevinAcpRuntimeDevinSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
}

export const makeDevinAcpRuntime = (
  input: DevinAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const { childProcessSpawner, devinSettings, environment, runtimeMode, ...options } = input;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...options,
        spawn: buildDevinAcpSpawnInput(devinSettings, input.cwd, environment, runtimeMode),
        clientCapabilities: options.clientCapabilities ?? {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          _meta: DEVIN_ACP_CLIENT_CAPABILITIES_META,
        },
      }).pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner)),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

const DEVIN_READ_ONLY_MODE_IDS = new Set(["plan", "ask"]);
// First match in the session's advertised modes wins.
const DEVIN_MODE_BY_RUNTIME_MODE: Partial<Record<RuntimeMode, ReadonlyArray<string>>> = {
  "auto-accept-edits": ["accept-edits", "code"],
  auto: ["smart"],
  "full-access": ["bypass"],
};

/**
 * The Devin session mode for a runtime mode. Returns `undefined` when the
 * current mode already expresses the requested posture. Plan mode is applied
 * on top of this by the shared ACP adapter.
 */
export function resolveDevinModeId(input: {
  readonly runtimeMode: RuntimeMode;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modeState = input.modeState;
  if (!modeState) {
    return undefined;
  }
  const preferredIds = DEVIN_MODE_BY_RUNTIME_MODE[input.runtimeMode];
  const resolved =
    preferredIds !== undefined
      ? findAcpModeByAliases(modeState.availableModes, preferredIds)?.id
      : // approval-required: `normal` is spawn-flag only. If an earlier plan/ask
        // turn left a read-only mode active, restore the least-privileged
        // writable mode so the agent can keep working under supervision.
        DEVIN_READ_ONLY_MODE_IDS.has(modeState.currentModeId)
        ? (findAcpModeByAliases(modeState.availableModes, ["accept-edits", "code"])?.id ??
          modeState.availableModes.find((mode) => !DEVIN_READ_ONLY_MODE_IDS.has(mode.id))?.id)
        : undefined;
  return resolved === modeState.currentModeId ? undefined : resolved;
}

/**
 * Applies a grouped Devin model selection. The picker groups variants into
 * one row per family with effort/speed/context options, so those dims are
 * resolved back to a concrete advertised uid before `set_model`. Returns the
 * uid the session now runs on.
 */
export const applyDevinAcpModelSelection = Effect.fn("applyDevinAcpModelSelection")(function* <
  E,
>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "getConfigOptions"> & {
    readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  };
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.fn.Return<string | undefined, E> {
  const configOptions = yield* input.runtime.getConfigOptions;
  const modelOption =
    configOptions.find((candidate) => candidate.category === "model") ??
    configOptions.find((candidate) => candidate.id === "model");
  const currentValue =
    modelOption?.type === "select" && typeof modelOption.currentValue === "string"
      ? modelOption.currentValue
      : undefined;
  const model = input.model?.trim();
  if (!model) return currentValue;
  const advertisedValues = modelOption ? collectSessionConfigOptionValues(modelOption) : [];
  const resolved =
    advertisedValues.length > 0
      ? resolveDevinModelUid({
          model,
          selections: input.selections,
          advertisedValues,
          currentValue,
        })
      : model;
  if (resolved !== currentValue) {
    yield* input.runtime.setModel(resolved).pipe(Effect.mapError(input.mapError));
  }
  return resolved;
});
