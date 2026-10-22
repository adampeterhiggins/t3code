import { useState, type CSSProperties } from "react";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useEnvironmentThemeDefinitions } from "../../hooks/useEnvironmentTheme";
import { resolveQuickMessageAppearance } from "../../quickMessageAppearance";
import {
  getStandardThemeColors,
  getThemeDefinition,
  getThemeColorsForMode,
} from "../../themePalette";
import { Select, SelectTrigger, SelectValue, SelectItem, SelectPopup } from "../ui/select";
import { SettingsRow, SettingsSection, SettingResetButton } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const SOURCES = { app: "Follow app", adapt: "Adapt app theme", theme: "Choose theme" } as const;
const APPEARANCES = { app: "Same as app", system: "System", light: "Light", dark: "Dark" } as const;

export function QuickMessageAppearanceSettings() {
  const settings = useClientSettings();
  const app = useTheme();
  const customThemes = useCustomThemes();
  const environmentThemes = useEnvironmentThemeDefinitions();
  const [backdrop, setBackdrop] = useState("light");
  const [error, setError] = useState<string | null>(null);
  if (!window.desktopBridge?.quickMessage) return null;

  const save = (patch: Parameters<typeof updateClientSettings>[0]) => {
    setError(null);
    void updateClientSettings(patch).catch(() =>
      setError("Could not save quick message appearance."),
    );
  };
  const themes = [...BUILT_IN_THEMES, ...environmentThemes, ...customThemes];
  const resolved = resolveQuickMessageAppearance(
    settings,
    {
      theme: app.theme,
      appearance: app.resolvedTheme,
      halves: app.themeHalves,
    },
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const definition = getThemeDefinition(resolved.theme);
  const colors =
    (definition && getThemeColorsForMode(definition, resolved.appearance)) ??
    getStandardThemeColors(resolved.appearance);
  const previewStyle = {
    "--quick-preview-surface":
      definition || resolved.appearance === "dark" ? colors.surfaceRaised : colors.surface,
    "--quick-preview-text": colors.text,
    "--quick-preview-muted": colors.secondaryLabel,
    "--quick-preview-border": colors.border,
    "--quick-preview-action": colors.messageAction,
    "--quick-preview-action-text": colors.messageActionForeground,
    "--quick-preview-canvas": colors.canvas,
    "--appearance-contrast-base": `${Math.min(resolved.contrast, 100)}%`,
    "--appearance-contrast-boost": `${Math.max(resolved.contrast - 100, 0)}%`,
    "--appearance-contrast-border-boost": `${Math.max(resolved.contrast - 100, 0) / 4}%`,
    "--appearance-contrast-target": resolved.appearance === "dark" ? "white" : "black",
  } as CSSProperties;
  const themeItems = [
    { value: "light", label: "T3 Code" },
    ...themes.map((theme) => ({ value: theme.id, label: theme.label })),
    ...(!["light", "dark", "system", ...themes.map((theme) => theme.id)].includes(
      settings.quickMessageTheme,
    )
      ? [{ value: settings.quickMessageTheme, label: "Unavailable theme (following app)" }]
      : []),
  ];
  return (
    <SettingsSection {...searchableSetting("quick-message-appearance")} title="Quick message">
      <SettingsRow
        title="Theme source"
        description="Only affects the floating quick message window."
        status={error ?? undefined}
        resetAction={
          settings.quickMessageThemeSource !== "app" ? (
            <SettingResetButton
              label="quick message appearance"
              tooltip="Follow app theme"
              onClick={() => save({ quickMessageThemeSource: "app" })}
            />
          ) : undefined
        }
        control={
          <Select
            value={settings.quickMessageThemeSource}
            onValueChange={(value) => value && save({ quickMessageThemeSource: value })}
          >
            <SelectTrigger>
              <SelectValue>{SOURCES[settings.quickMessageThemeSource]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {Object.entries(SOURCES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {settings.quickMessageThemeSource === "theme" && (
        <SettingsRow
          title="Theme"
          control={
            <Select
              items={themeItems}
              value={
                settings.quickMessageTheme === "dark" || settings.quickMessageTheme === "system"
                  ? "light"
                  : settings.quickMessageTheme
              }
              onValueChange={(value) => value && save({ quickMessageTheme: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {themeItems.map((theme) => (
                  <SelectItem key={theme.value} value={theme.value}>
                    {theme.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      )}
      {settings.quickMessageThemeSource !== "app" && (
        <SettingsRow
          title="Appearance"
          description="Themes with only one appearance keep their supported mode."
          control={
            <Select
              value={settings.quickMessageAppearance}
              onValueChange={(value) => value && save({ quickMessageAppearance: value })}
            >
              <SelectTrigger>
                <SelectValue>{APPEARANCES[settings.quickMessageAppearance]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {Object.entries(APPEARANCES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      )}
      {settings.quickMessageThemeSource === "adapt" && (
        <SettingsRow
          title="Extra contrast"
          description="Add to the app’s text and border contrast, up to 200%."
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                htmlFor="quick-message-extra-contrast"
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              >
                +{settings.quickMessageExtraContrast}%
              </output>
              <input
                id="quick-message-extra-contrast"
                aria-label="Quick message extra contrast"
                className="settings-slider min-w-0 flex-1"
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.quickMessageExtraContrast}
                onChange={(e) => save({ quickMessageExtraContrast: Number(e.currentTarget.value) })}
                style={
                  {
                    "--settings-slider-progress": `${settings.quickMessageExtraContrast}%`,
                    "--settings-slider-fill-offset": `${0.5 - settings.quickMessageExtraContrast / 100}rem`,
                  } as CSSProperties
                }
              />
            </div>
          }
        />
      )}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Preview over another app</p>
          <div className="w-32">
            <Select value={backdrop} onValueChange={(value) => value && setBackdrop(value)}>
              <SelectTrigger size="sm">
                <SelectValue>{backdrop === "light" ? "Light" : "Dark"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        </div>
        <div
          className="quick-message-theme-preview rounded-xl p-5"
          style={{ ...previewStyle, background: backdrop === "light" ? "#f4f4f5" : "#18181b" }}
        >
          <div
            className="quick-message-theme-preview-composer rounded-3xl border p-4 shadow-lg"
            aria-label="Quick message theme preview"
          >
            <div className="flex items-center justify-between text-xs">
              <span>t3code⌄</span>
              <span>···</span>
            </div>
            <p className="quick-message-theme-preview-prompt py-5 text-sm">Ask anything…</p>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <span>Model ⌄　 Medium ⌄</span>
              <span className="quick-message-theme-preview-action rounded-full px-3 py-2">
                Create worktree
              </span>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
