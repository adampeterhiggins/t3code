import type { EnvironmentId } from "@t3tools/contracts";
import {
  CONDUCTOR_LOCAL_SETTINGS_PATH,
  CONDUCTOR_SETTINGS_PATH,
  WORKTREE_INCLUDE_PATH,
  resolveConductorSettings,
  type ConductorSettingsFilePath,
  type ResolvedConductorSettings,
} from "@t3tools/shared/conductorSettings";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

function fileContents(query: ReturnType<typeof useProjectFileQuery>): string | null {
  return query.data && !query.data.truncated ? query.data.contents : null;
}

export interface ConductorSettingsState {
  /** Raw contents of each settings file, null when missing or unreadable. */
  readonly files: Record<ConductorSettingsFilePath, string | null>;
  readonly worktreeInclude: string | null;
  readonly resolved: ResolvedConductorSettings;
}

/**
 * The project checkout's Conductor settings, read through the project file
 * queries so in-app edits show up immediately. Reads every file Conductor
 * does, so the client resolves exactly what the server applies. Pass a null
 * `cwd` to skip the reads.
 */
export function useConductorSettings(
  environmentId: EnvironmentId,
  cwd: string | null,
): ConductorSettingsState {
  const root = cwd ?? "";
  const enabled = cwd !== null;
  const legacy = fileContents(useProjectFileQuery(environmentId, root, "conductor.json", enabled));
  const sharedJson = fileContents(
    useProjectFileQuery(environmentId, root, ".conductor/settings.json", enabled),
  );
  const shared = fileContents(
    useProjectFileQuery(environmentId, root, CONDUCTOR_SETTINGS_PATH, enabled),
  );
  const localJson = fileContents(
    useProjectFileQuery(environmentId, root, ".conductor/settings.local.json", enabled),
  );
  const local = fileContents(
    useProjectFileQuery(environmentId, root, CONDUCTOR_LOCAL_SETTINGS_PATH, enabled),
  );
  const worktreeInclude = fileContents(
    useProjectFileQuery(environmentId, root, WORKTREE_INCLUDE_PATH, enabled),
  );
  return useMemo(() => {
    const files = {
      "conductor.json": legacy,
      ".conductor/settings.json": sharedJson,
      [CONDUCTOR_SETTINGS_PATH]: shared,
      ".conductor/settings.local.json": localJson,
      [CONDUCTOR_LOCAL_SETTINGS_PATH]: local,
    };
    return {
      files,
      worktreeInclude,
      resolved: resolveConductorSettings({ files, worktreeInclude }),
    };
  }, [legacy, sharedJson, shared, localJson, local, worktreeInclude]);
}
