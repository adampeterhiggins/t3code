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
import { buildOrganisationOptions, repositoryOrganisationOf } from "./organization.logic";

const SIDEBAR_ORGANISATIONS_KEY = "t3code:sidebar:organisations";
const NO_ORGANISATION_KEYS: readonly string[] = [];
const ORGANISATION_KEYS_SCHEMA = Schema.Array(Schema.String);

export function useSidebarProjectScope(
  projectGroups: readonly SidebarProjectSnapshot[],
  projectGroupingSettings: NonNullable<
    Parameters<typeof resolveSidebarProjectScopeKey>[0]["settings"]
  >,
) {
  const persistedProjectScopeKeys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const setProjectScopeKeys = useUiStateStore((store) => store.setSidebarProjectScopeKeys);
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
  const [storedOrganisationKeys, setOrganisationKeys] = useLocalStorage(
    SIDEBAR_ORGANISATIONS_KEY,
    NO_ORGANISATION_KEYS,
    ORGANISATION_KEYS_SCHEMA,
  );
  const { organisations } = useOrganisations();
  // A picked organisation with no checkout left still narrows the list, so it stays offered
  // (and pilled) until it is dropped rather than silently coming back with a new checkout.
  // Until projects load nothing has an organisation yet, so the saved picks wait rather than
  // emptying the list for a moment.
  const scopedOrganisationKeys =
    projectGroups.length === 0 ? NO_ORGANISATION_KEYS : storedOrganisationKeys;
  const organisationOptions = buildOrganisationOptions(
    projectGroups.flatMap((project) =>
      project.memberProjects.map((member) => member.repositoryIdentity),
    ),
    organisations,
    scopedOrganisationKeys,
  );
  const scopedProjectKeys = (() => {
    if (scopedProjectGroups.length === 0 && scopedOrganisationKeys.length === 0) return null;
    const organisations = new Set(scopedOrganisationKeys);
    return new Set(
      (scopedProjectGroups.length > 0 ? scopedProjectGroups : projectGroups).flatMap((project) =>
        project.memberProjects
          .filter(
            (member) =>
              organisations.size === 0 ||
              organisations.has(repositoryOrganisationOf(member.repositoryIdentity)?.key ?? ""),
          )
          .map((member) => `${member.environmentId}:${member.id}`),
      ),
    );
  })();
  // Scoped projects that are gone drop out of the scope. Configs identify
  // scratch projects, so both they and live project snapshots must arrive
  // before a persisted scope can be considered missing.
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const allProjectConfigsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  // oxlint-disable-next-line t3code/react-effect-budget -- Reconcile saved scopes only after environment snapshots and configs load.
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
      setProjectScopeKeys(nextKeys);
    }
  }, [
    allProjectConfigsReady,
    allProjectSnapshotsReady,
    persistedProjectScopeKeys,
    projectGroups,
    projectGroupingSettings,
    setProjectScopeKeys,
  ]);
  return {
    persistedProjectScopeKeys,
    setProjectScopeKeys,
    projectScopeKeys,
    scopedProjectGroups,
    storedOrganisationKeys,
    setOrganisationKeys,
    scopedOrganisationKeys,
    organisationOptions,
    scopedProjectKeys,
  };
}
