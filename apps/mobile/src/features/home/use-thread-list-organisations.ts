import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useCallback, useMemo, useState } from "react";

import { buildOrganisationOptions, toggleOrganisationKey } from "./thread-list-organisations";

const NO_ORGANISATIONS: ReadonlyArray<string> = [];

/** The Organisations filter, kept in memory like the project filter. */
export function useThreadListOrganisations(projects: ReadonlyArray<EnvironmentProject>) {
  const organisations = useMemo(() => buildOrganisationOptions(projects), [projects]);
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
