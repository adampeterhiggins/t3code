import type { ServerSettingsPatch } from "@t3tools/contracts";
import { useRef } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/AppText";
import { SettingsSection } from "./SettingsSection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

export function PythonEnvironmentSettings(props: {
  activate: boolean | null;
  interpreterPath: string | null;
  disabled: boolean;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const pathEdited = useRef(false);
  return (
    <SettingsSection title="Terminal">
      <SettingsSwitchRow
        icon="terminal"
        label="Activate Python environment"
        subtitle="New terminals activate the project's Python environment."
        value={props.activate}
        disabled={props.disabled}
        onValueChange={(value) => props.onChange({ terminalActivatePythonEnvironment: value })}
      />
      {props.activate !== false ? (
        <View className="gap-2 border-t border-border-subtle px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            An interpreter or environment folder, such as .venv/bin/python or ~/miniconda3/envs/app.
            Leave empty to use the repository's t3.json, or find .venv or venv.
          </Text>
          <AppTextInput
            key={props.interpreterPath}
            accessibilityLabel="Python interpreter path"
            onChangeText={() => {
              pathEdited.current = true;
            }}
            defaultValue={props.interpreterPath ?? ""}
            placeholder={props.interpreterPath === null ? "Mixed" : ".venv or venv"}
            editable={!props.disabled}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={(event) => {
              const value = event.nativeEvent.text.trim();
              if (
                !props.disabled &&
                pathEdited.current &&
                (props.interpreterPath === null || value !== props.interpreterPath)
              )
                // Empty inherits from the next tier, ending at t3.json.
                props.onChange({ pythonInterpreterPath: value === "" ? null : value });
              pathEdited.current = false;
            }}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
