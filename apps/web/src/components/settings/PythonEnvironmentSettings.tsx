import { useRef } from "react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import { Input } from "../ui/input";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function PythonEnvironmentSettings() {
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const pathEdited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const activateMixed = useScopedSettingsMixed(["terminalActivatePythonEnvironment"]);
  const pathMixed = useScopedSettingsMixed(["pythonInterpreterPath"]);
  // At project scope the target already carries the checkout's t3.json value.
  const interpreterPath = settings.pythonInterpreterPath ?? "";

  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["terminalActivatePythonEnvironment"]}
        {...searchableSetting("terminal-activate-python-environment")}
        description="New terminals activate the project's Python environment."
        resetAction={
          settings.terminalActivatePythonEnvironment !==
          DEFAULT_SERVER_SETTINGS.terminalActivatePythonEnvironment ? (
            <SettingResetButton
              label="activate Python environment in terminals"
              onClick={() =>
                updateSettings({
                  terminalActivatePythonEnvironment:
                    DEFAULT_SERVER_SETTINGS.terminalActivatePythonEnvironment,
                })
              }
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["terminalActivatePythonEnvironment"]}
            checked={settings.terminalActivatePythonEnvironment}
            onCheckedChange={(checked) =>
              updateSettings({ terminalActivatePythonEnvironment: Boolean(checked) })
            }
            aria-label="Activate Python environment in new terminals"
          />
        }
      />
      {activateMixed || settings.terminalActivatePythonEnvironment ? (
        <SettingsRow
          serverScoped
          settingKeys={["pythonInterpreterPath"]}
          title="Python interpreter path"
          description="An interpreter or environment folder, such as .venv/bin/python or ~/miniconda3/envs/app. Relative paths start at the terminal's folder. Leave empty to use the repository's t3.json, or find .venv or venv."
          resetAction={
            pathMixed || settings.pythonInterpreterPath !== null ? (
              <SettingResetButton
                label="Python interpreter path"
                onClick={() => updateSettings({ pythonInterpreterPath: null })}
              />
            ) : null
          }
          control={
            <Input
              key={`${scopeKey}:${pathMixed}:${interpreterPath}`}
              aria-label="Python interpreter path"
              autoCapitalize="none"
              spellCheck={false}
              onChange={() => {
                pathEdited.current = true;
              }}
              placeholder={pathMixed ? "Mixed" : ".venv or venv"}
              defaultValue={pathMixed ? "" : interpreterPath}
              onBlur={(event) => {
                const value = event.target.value.trim();
                // Empty inherits: the project falls back to the environment,
                // the environment to t3.json.
                if (pathEdited.current && (pathMixed || value !== interpreterPath))
                  updateSettings({ pythonInterpreterPath: value === "" ? null : value });
                pathEdited.current = false;
              }}
            />
          }
        />
      ) : null}
    </>
  );
}
