/**
 * CustomAcpProvider — health check and model discovery for a user-configured
 * ACP agent.
 *
 * The check starts a throwaway session: `session/new` is the only place ACP
 * advertises models, modes, and config options, so there is no cheaper probe
 * that works for every agent.
 *
 * @module CustomAcpProvider
 */
import type { CustomAcpSettings, ServerProviderModel } from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  buildServerProvider,
  isCommandMissingCause,
  providerModelsFromSettings,
  type ServerProviderDraft,
  type ServerProviderPresentation,
} from "@t3tools/provider-core/server/snapshotProbe";
import {
  customAcpModelsFromSession,
  customAcpSupportsPlanMode,
  makeCustomAcpRuntime,
} from "./acp/CustomAcpSupport.ts";

const DISPLAY_NAME = "Custom ACP";
// Agents may boot MCP servers or index the workspace on session/new.
const PROBE_TIMEOUT_MS = 20_000;
const isAcpSpawnError = Schema.is(EffectAcpErrors.AcpSpawnError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);
// ACP's `auth_required` error code.
const ACP_AUTH_REQUIRED_CODE = -32000;

function presentation(input?: {
  readonly agentName?: string | undefined;
  readonly supportsPlanMode?: boolean;
}): ServerProviderPresentation {
  return {
    displayName: input?.agentName || DISPLAY_NAME,
    badgeLabel: "Early Access",
    supportsConversationRollback: false,
    showInteractionModeToggle: input?.supportsPlanMode ?? false,
  };
}

function withCustomModels(
  settings: CustomAcpSettings,
  discovered: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    discovered,
    settings.customModels,
    discovered[0]?.capabilities ?? { optionDescriptors: [] },
  );
}

const fallbackModels = (settings: CustomAcpSettings) =>
  withCustomModels(settings, customAcpModelsFromSession({}));

export const buildInitialCustomAcpProviderSnapshot = Effect.fn(
  "buildInitialCustomAcpProviderSnapshot",
)(function* (settings: CustomAcpSettings) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return buildServerProvider({
    presentation: presentation(),
    enabled: settings.enabled,
    checkedAt,
    models: fallbackModels(settings),
    probe: {
      installed: settings.binaryPath.length > 0,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: settings.enabled
        ? "Checking the ACP agent..."
        : "This ACP agent is disabled in T3 Code settings.",
    },
  });
});

export const checkCustomAcpProviderStatus = Effect.fn("checkCustomAcpProviderStatus")(function* (
  settings: CustomAcpSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const unavailable = (probe: {
    readonly installed: boolean;
    readonly message: string;
    readonly unauthenticated?: boolean;
  }) =>
    buildServerProvider({
      presentation: presentation(),
      enabled: settings.enabled,
      checkedAt,
      models: fallbackModels(settings),
      probe: {
        installed: probe.installed,
        version: null,
        status: "error",
        auth: { status: probe.unauthenticated ? "unauthenticated" : "unknown" },
        message: probe.message,
      },
    });

  if (!settings.enabled) {
    return buildServerProvider({
      presentation: presentation(),
      enabled: false,
      checkedAt,
      models: fallbackModels(settings),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "This ACP agent is disabled in T3 Code settings.",
      },
    });
  }
  if (!settings.binaryPath) {
    return unavailable({
      installed: false,
      message: "Set the agent executable in Settings → Providers.",
    });
  }

  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exit = yield* makeCustomAcpRuntime({
    settings,
    environment,
    childProcessSpawner,
    cwd,
    clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
  }).pipe(
    Effect.flatMap((acp) => acp.start()),
    Effect.scoped,
    Effect.timeoutOption(PROBE_TIMEOUT_MS),
    Effect.exit,
  );

  if (Exit.isFailure(exit)) {
    const error = Cause.findErrorOption(exit.cause).pipe(Option.getOrUndefined);
    yield* Effect.logWarning("Custom ACP agent probe failed.", {
      errorTag: causeErrorTag(exit.cause),
    });
    if (isAcpSpawnError(error) && isCommandMissingCause(error.cause)) {
      return unavailable({
        installed: false,
        message: `\`${settings.binaryPath}\` is not installed or not on PATH.`,
      });
    }
    if (isAcpRequestError(error) && error.code === ACP_AUTH_REQUIRED_CODE) {
      return unavailable({
        installed: true,
        unauthenticated: true,
        message: "The agent needs you to sign in. Sign in with its own CLI, then refresh.",
      });
    }
    return unavailable({
      installed: true,
      message: `The agent did not start an ACP session: ${error?.message ?? "unknown error"}. Check the executable and arguments.`,
    });
  }
  if (Option.isNone(exit.value)) {
    return unavailable({
      installed: true,
      message: "The agent did not answer ACP initialize and session/new in time.",
    });
  }

  const started = exit.value.value;
  const agentInfo = started.initializeResult.agentInfo;
  return buildServerProvider({
    presentation: presentation({
      agentName: agentInfo?.title?.trim() || agentInfo?.name?.trim(),
      supportsPlanMode: customAcpSupportsPlanMode(started.sessionSetupResult),
    }),
    enabled: true,
    checkedAt,
    models: withCustomModels(settings, customAcpModelsFromSession(started.sessionSetupResult)),
    probe: {
      installed: true,
      version: agentInfo?.version?.trim() || null,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});
