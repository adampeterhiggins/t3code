import type { EnvironmentId, ProjectReadFileResult } from "@t3tools/contracts";
import {
  CONDUCTOR_LOCAL_SETTINGS_PATH,
  CONDUCTOR_SETTINGS_PATH,
  WORKTREE_INCLUDE_PATH,
  resolveConductorSettings,
  type ConductorSettingsFilePath,
  type ResolvedConductorSettings,
} from "@t3tools/shared/conductorSettings";
import { useCallback, useMemo } from "react";

import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";

export interface ConductorSettingsState {
  /** Raw contents of each settings file, null when missing or unreadable. */
  readonly files: Record<ConductorSettingsFilePath, string | null>;
  readonly worktreeInclude: string | null;
  readonly resolved: ResolvedConductorSettings;
  /** Re-reads every file, after this client writes one. */
  readonly refresh: () => void;
}

function useProjectFile(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  relativePath: string,
) {
  const query = useEnvironmentQuery(
    environmentId === null || cwd === null || cwd === ""
      ? null
      : projectEnvironment.readFile({ environmentId, input: { cwd, relativePath } }),
  );
  const data = query.data as ProjectReadFileResult | null;
  return {
    contents: data === null || data.truncated ? null : data.contents,
    refresh: query.refresh,
  };
}

/**
 * The project checkout's Conductor settings, read the way the server reads
 * them so the terminal menu's run scripts and the settings editor match what
 * new worktrees get. Pass a null environment or `cwd` to skip the reads.
 */
export function useConductorSettings(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): ConductorSettingsState {
  const legacy = useProjectFile(environmentId, cwd, "conductor.json");
  const sharedJson = useProjectFile(environmentId, cwd, ".conductor/settings.json");
  const shared = useProjectFile(environmentId, cwd, CONDUCTOR_SETTINGS_PATH);
  const localJson = useProjectFile(environmentId, cwd, ".conductor/settings.local.json");
  const local = useProjectFile(environmentId, cwd, CONDUCTOR_LOCAL_SETTINGS_PATH);
  const worktreeInclude = useProjectFile(environmentId, cwd, WORKTREE_INCLUDE_PATH);

  const refreshLegacy = legacy.refresh;
  const refreshSharedJson = sharedJson.refresh;
  const refreshShared = shared.refresh;
  const refreshLocalJson = localJson.refresh;
  const refreshLocal = local.refresh;
  const refreshWorktreeInclude = worktreeInclude.refresh;
  const refresh = useCallback(() => {
    refreshLegacy();
    refreshSharedJson();
    refreshShared();
    refreshLocalJson();
    refreshLocal();
    refreshWorktreeInclude();
  }, [
    refreshLegacy,
    refreshSharedJson,
    refreshShared,
    refreshLocalJson,
    refreshLocal,
    refreshWorktreeInclude,
  ]);

  return useMemo(() => {
    const files = {
      "conductor.json": legacy.contents,
      ".conductor/settings.json": sharedJson.contents,
      [CONDUCTOR_SETTINGS_PATH]: shared.contents,
      ".conductor/settings.local.json": localJson.contents,
      [CONDUCTOR_LOCAL_SETTINGS_PATH]: local.contents,
    };
    return {
      files,
      worktreeInclude: worktreeInclude.contents,
      resolved: resolveConductorSettings({ files, worktreeInclude: worktreeInclude.contents }),
      refresh,
    };
  }, [
    legacy.contents,
    sharedJson.contents,
    shared.contents,
    localJson.contents,
    local.contents,
    worktreeInclude.contents,
    refresh,
  ]);
}
