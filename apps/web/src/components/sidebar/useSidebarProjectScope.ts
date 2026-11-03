import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useOrganisations } from "../../hooks/useOrganisations";
import { useUiStateStore } from "../../uiStateStore";
import { useAllEnvironmentProjectSnapshotsReady } from "../../state/entities";
import { environmentProjects } from "../../state/projects";
import {
  resolveSidebarProjectScopeKey,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { buildSidebarOrganisationOptions, sidebarScopedMemberKeys } from "./organization.logic";

const SIDEBAR_ORGANISATIONS_KEY = "t3code:sidebar:organisations";
const SIDEBAR_EXCLUDED_ORGANISATIONS_KEY = "t3code:sidebar:excluded-organisations";
const SIDEBAR_EXCLUDED_PROJECTS_KEY = "t3code:sidebar:excluded-projects";
const NO_ORGANISATION_KEYS: readonly string[] = [];
const ORGANISATION_KEYS_SCHEMA = Schema.Array(Schema.String);

export function useSidebarProjectScope(
  projectGroups: readonly SidebarProjectSnapshot[],
  projectGroupingSettings: NonNullable<
    Parameters<typeof resolveSidebarProjectScopeKey>[0]["settings"]
  >,
) {
  const persistedProjectScopeKeys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const setPickedProjectKeys = useUiStateStore((store) => store.setSidebarProjectScopeKeys);
  // Exclusions are the other way to narrow a dimension: everything but them, so new projects
  // and organisations still show. A dimension holds picks or exclusions, never both.
  const [storedExcludedProjectKeys, setStoredExcludedProjectKeys] = useLocalStorage(
    SIDEBAR_EXCLUDED_PROJECTS_KEY,
    NO_ORGANISATION_KEYS,
    ORGANISATION_KEYS_SCHEMA,
  );
  const setProjectScopeKeys = (keys: readonly string[]) => {
    setPickedProjectKeys(keys);
    if (keys.length > 0) setStoredExcludedProjectKeys(NO_ORGANISATION_KEYS);
  };
  const setExcludedProjectKeys = (keys: readonly string[]) => {
    setStoredExcludedProjectKeys(keys);
    if (keys.length > 0) setPickedProjectKeys([]);
  };
  // A saved physical scratch scope maps onto the group its environment config
  // coalesces it into (see resolveSidebarProjectScopeKey).
  const projectScopeKeys = [
    ...new Set(
      persistedProjectScopeKeys.flatMap((key) => {
        const resolved = resolveSidebarProjectScopeKey({
          groups: projectGroups,
          key,
          settings: projectGroupingSettings,
        });
        return resolved === null ? [] : [resolved];
      }),
    ),
  ];
  const projectGroupByScopeKey = new Map(
    projectGroups.map((project) => [project.projectKey, project] as const),
  );
  const scopedProjectGroups = projectScopeKeys.flatMap((key) => {
    const project = projectGroupByScopeKey.get(key);
    return project ? [project] : [];
  });
  // Organisations narrow the same way projects do, per checkout: a project group can hold
  // checkouts from a fork and its upstream, which belong to different owners.
  const [storedOrganisationKeys, setStoredOrganisationKeys] = useLocalStorage(
    SIDEBAR_ORGANISATIONS_KEY,
    NO_ORGANISATION_KEYS,
    ORGANISATION_KEYS_SCHEMA,
  );
  const [storedExcludedOrganisationKeys, setStoredExcludedOrganisationKeys] = useLocalStorage(
    SIDEBAR_EXCLUDED_ORGANISATIONS_KEY,
    NO_ORGANISATION_KEYS,
    ORGANISATION_KEYS_SCHEMA,
  );
  const setOrganisationKeys = (keys: readonly string[]) => {
    setStoredOrganisationKeys(keys);
    if (keys.length > 0) setStoredExcludedOrganisationKeys(NO_ORGANISATION_KEYS);
  };
  const setExcludedOrganisationKeys = (keys: readonly string[]) => {
    setStoredExcludedOrganisationKeys(keys);
    if (keys.length > 0) setStoredOrganisationKeys(NO_ORGANISATION_KEYS);
  };
  const { organisations } = useOrganisations();
  // A picked organisation with no checkout left still narrows the list, so it stays offered
  // (and pilled) until it is dropped rather than silently coming back with a new checkout.
  // Until projects load nothing has an organisation yet, so the saved picks wait rather than
  // emptying the list for a moment.
  const scopedOrganisationKeys =
    projectGroups.length === 0 ? NO_ORGANISATION_KEYS : storedOrganisationKeys;
  const excludedOrganisationKeys =
    projectGroups.length === 0 ? NO_ORGANISATION_KEYS : storedExcludedOrganisationKeys;
  const organisationOptions = buildSidebarOrganisationOptions(
    projectGroups.flatMap((project) =>
      project.memberProjects.map((member) => member.repositoryIdentity),
    ),
    organisations,
    [...scopedOrganisationKeys, ...excludedOrganisationKeys],
  );
  const excludedProjectKeys = [
    ...new Set(
      storedExcludedProjectKeys.flatMap((key) => {
        const resolved = resolveSidebarProjectScopeKey({
          groups: projectGroups,
          key,
          settings: projectGroupingSettings,
        });
        return resolved === null ? [] : [resolved];
      }),
    ),
  ];
  const projectScope = {
    picked: scopedProjectGroups.map((project) => project.projectKey),
    excluded: excludedProjectKeys,
  };
  const organisationScope = {
    picked: scopedOrganisationKeys,
    excluded: excludedOrganisationKeys,
  };
  const scopedProjectKeys = sidebarScopedMemberKeys({
    projects: projectGroups,
    projectScope,
    organisationScope,
  });
  // Scoped projects that are gone drop out of the scope. Configs identify
  // scratch projects, so both they and live project snapshots must arrive
  // before a persisted scope can be considered missing.
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const allProjectConfigsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reconcile saved scopes only after environment snapshots and configs load.
  useEffect(() => {
    const canClearMissingScope = allProjectSnapshotsReady && allProjectConfigsReady;
    const nextKeys = [
      ...new Set(
        persistedProjectScopeKeys.flatMap((key) => {
          const resolved = resolveSidebarProjectScopeKey({
            groups: projectGroups,
            key,
            settings: projectGroupingSettings,
            canClearMissingScope,
          });
          return resolved === null ? [] : [resolved];
        }),
      ),
    ];
    if (
      nextKeys.length !== persistedProjectScopeKeys.length ||
      nextKeys.some((key, index) => key !== persistedProjectScopeKeys[index])
    ) {
      setPickedProjectKeys(nextKeys);
    }
  }, [
    allProjectConfigsReady,
    allProjectSnapshotsReady,
    persistedProjectScopeKeys,
    projectGroups,
    projectGroupingSettings,
    setPickedProjectKeys,
  ]);
  return {
    persistedProjectScopeKeys,
    setProjectScopeKeys,
    projectScopeKeys,
    storedExcludedProjectKeys,
    excludedProjectKeys,
    setExcludedProjectKeys,
    storedExcludedOrganisationKeys,
    excludedOrganisationKeys,
    setExcludedOrganisationKeys,
    projectScope,
    organisationScope,
    scopedProjectGroups,
    storedOrganisationKeys,
    setOrganisationKeys,
    scopedOrganisationKeys,
    organisationOptions,
    scopedProjectKeys,
  };
}
