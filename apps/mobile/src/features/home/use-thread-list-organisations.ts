import { useAtomValue } from "@effect/atom-react";
import { mergeSharedSettingMaps } from "@t3tools/client-runtime/state/shared-settings";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useCallback, useMemo, useState } from "react";

import { environmentServerConfigsAtom } from "../../state/server";

import { buildOrganisationOptions, toggleOrganisationKey } from "./thread-list-organisations";

const NO_ORGANISATIONS: ReadonlyArray<string> = [];

/** The Organisations filter, kept in memory like the project filter. */
export function useThreadListOrganisations(projects: ReadonlyArray<EnvironmentProject>) {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  // Names are a shared server setting; the first environment to hold one wins.
  const names = useMemo(
    () =>
      mergeSharedSettingMaps(
        [...serverConfigs.values()].map((config) => config.settings.organisations),
      ),
    [serverConfigs],
  );
  const organisations = useMemo(() => buildOrganisationOptions(projects, names), [names, projects]);
  const [pickedKeys, setPickedKeys] = useState(NO_ORGANISATIONS);
  // Organisations that no longer have a checkout stop narrowing the list.
  const organisationKeys = useMemo(
    () => pickedKeys.filter((key) => organisations.some((option) => option.key === key)),
    [organisations, pickedKeys],
  );
  const toggleOrganisation = useCallback(
    (key: string) => setPickedKeys(toggleOrganisationKey(organisationKeys, key)),
    [organisationKeys],
  );
  const clearOrganisations = useCallback(() => setPickedKeys(NO_ORGANISATIONS), []);
  return { organisations, organisationKeys, toggleOrganisation, clearOrganisations } as const;
}
