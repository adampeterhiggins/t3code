import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "../../../../state/preferences";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { setThemeSyncEnabled } from "../themeSync";

export function ThemeSyncSection() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const enabled = AsyncResult.isSuccess(preferences) && preferences.value.themeSyncEnabled === true;

  return (
    <SettingsSection title="Devices">
      <SettingsSwitchRow
        disabled={!AsyncResult.isSuccess(preferences)}
        icon="laptopcomputer"
        label="Sync theme across devices"
        subtitle="Use the same light and dark themes on every device that turns this on."
        value={enabled}
        onValueChange={setThemeSyncEnabled}
      />
    </SettingsSection>
  );
}
