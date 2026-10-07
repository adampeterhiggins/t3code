import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Scan of Claude Code / Codex home directories on an environment, surfacing
 * project candidates for the welcome wizard's import step. The scan walks the
 * filesystem server-side, so results are cached briefly and refreshed when the
 * import step remounts.
 */
export const agentSessionScan = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:scan",
  tag: WS_METHODS.agentSessionsScan,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

/**
 * A project's Claude Code / Codex conversations for the import picker. Listing
 * reads transcripts on the environment, so a reopened picker reuses a fresh result.
 */
export const agentSessionList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:list",
  tag: WS_METHODS.agentSessionsList,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const agentSessionImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:import",
  tag: WS_METHODS.agentSessionsImport,
});

/** Conductor workspaces of a project's repository, for the import picker. */
export const conductorWorkspaceList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:conductor:workspaces",
  tag: WS_METHODS.conductorListWorkspaces,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const conductorWorkspaceImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:conductor:import-workspace",
  tag: WS_METHODS.conductorImportWorkspace,
});
