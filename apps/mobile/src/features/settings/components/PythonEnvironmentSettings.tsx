import type { ServerSettingsPatch } from "@t3tools/contracts";
import { T, useGT } from "gt-react-native";
import { useRef } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { SettingsSection } from "./SettingsSection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

export function PythonEnvironmentSettings(props: {
  activate: boolean | null;
  interpreterPath: string | null;
  disabled: boolean;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const gt = useGT();
  const pathEdited = useRef(false);
  return (
    <SettingsSection title={gt("Terminal")}>
      <SettingsSwitchRow
        icon="terminal"
        label={gt("Activate Python environment")}
        subtitle={gt("New terminals activate the project's Python environment.")}
        value={props.activate}
        disabled={props.disabled}
        onValueChange={(value) => props.onChange({ terminalActivatePythonEnvironment: value })}
      />
      {props.activate !== false ? (
        <View className="gap-2 border-t border-border-subtle px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            <T>
              An interpreter or environment folder, such as .venv/bin/python or
              ~/miniconda3/envs/app. Leave empty to use the repository's t3.json, or find .venv or
              venv.
            </T>
          </Text>
          <AppTextInput
            key={props.interpreterPath}
            accessibilityLabel={gt("Python interpreter path")}
            onChangeText={() => {
              pathEdited.current = true;
            }}
            defaultValue={props.interpreterPath ?? ""}
            placeholder={
              props.interpreterPath === null
                ? gt("Mixed", { $context: "settings differ across environments" })
                : gt("{first} or {second}", { first: ".venv", second: "venv" })
            }
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
