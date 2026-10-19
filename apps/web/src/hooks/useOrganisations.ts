import type { Organisation, Organisations } from "@t3tools/contracts/settings";
import { mergeSharedSettingMaps } from "@t3tools/client-runtime/state/shared-settings";
import { useAtomValue } from "@effect/atom-react";

import { environmentServerConfigsAtom } from "../state/server";
import { useUpdatePrimarySettings } from "./useSettings";

/**
 * Organisation names and icons, keyed by `repositoryOrganisationOf`'s key. Like thread groups
 * they are a shared server setting written to every connected environment, so reading merges
 * them and an organisation looks the same whichever server its checkouts are on.
 */
export function useOrganisations() {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const updateSettings = useUpdatePrimarySettings();
  const organisations: Organisations = mergeSharedSettingMaps(
    [...serverConfigs.values()].map((config) => config.settings.organisations),
  );

  /** Saves one organisation's look; an empty look removes its entry. */
  const saveOrganisation = (key: string, organisation: Organisation) => {
    const rest = { ...organisations };
    delete rest[key];
    updateSettings({
      organisations:
        organisation.name === undefined &&
        organisation.icon == null &&
        organisation.githubAvatar === undefined
          ? rest
          : { ...rest, [key]: organisation },
    });
  };

  return { organisations, saveOrganisation };
}
