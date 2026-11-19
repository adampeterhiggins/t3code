import { useGT } from "gt-react";
import { useRef } from "react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import { Input } from "../ui/input";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function PythonEnvironmentSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
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
        description={gt("New terminals activate the project's Python environment.")}
        resetAction={
          settings.terminalActivatePythonEnvironment !==
          DEFAULT_SERVER_SETTINGS.terminalActivatePythonEnvironment ? (
            <SettingResetButton
              ariaLabel={gt("Reset activate Python environment in terminals to default")}
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
            aria-label={gt("Activate Python environment in new terminals")}
          />
        }
      />
      {activateMixed || settings.terminalActivatePythonEnvironment ? (
        <SettingsRow
          serverScoped
          settingKeys={["pythonInterpreterPath"]}
          title={gt("Python interpreter path")}
          description={gt(
            "An interpreter or environment folder, such as .venv/bin/python or ~/miniconda3/envs/app. Relative paths start at the terminal's folder. Leave empty to use the repository's t3.json, or find .venv or venv.",
          )}
          resetAction={
            pathMixed || settings.pythonInterpreterPath !== null ? (
              <SettingResetButton
                ariaLabel={gt("Reset Python interpreter path to default")}
                onClick={() => updateSettings({ pythonInterpreterPath: null })}
              />
            ) : null
          }
          control={
            <Input
              key={`${scopeKey}:${pathMixed}:${interpreterPath}`}
              aria-label={gt("Python interpreter path")}
              autoCapitalize="none"
              spellCheck={false}
              onChange={() => {
                pathEdited.current = true;
              }}
              placeholder={
                pathMixed
                  ? gt("Mixed", { $context: "values differ across targets" })
                  : gt(".venv or venv")
              }
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
