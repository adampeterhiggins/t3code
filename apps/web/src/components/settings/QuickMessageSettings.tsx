import {
  DEFAULT_CLIENT_SETTINGS,
  isModifierPairShortcut,
  type DesktopQuickMessageState,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { sameSnapShotShortcut, snapShotKeybindingConflict } from "../../lib/snapShotShortcut";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { commandLabel } from "./KeybindingsSettings.logic";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";

export function QuickMessageSettingsRow() {
  const quickMessage = window.desktopBridge?.quickMessage;
  const enabled = useClientSettings((settings) => settings.quickMessageEnabled);
  const shortcut = useClientSettings((settings) => settings.quickMessageShortcut);
  const snapShotEnabled = useClientSettings((settings) => settings.snapShotEnabled);
  const snapShotShortcut = useClientSettings((settings) => settings.snapShotShortcut);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [state, setState] = useState<DesktopQuickMessageState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void quickMessage
      ?.getState()
      .then(setState)
      .catch(() => undefined);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the shortcut registration from the Electron main process
  useEffect(refresh, [quickMessage]);

  const save = (patch: Parameters<typeof updateClientSettings>[0]) => {
    setError(null);
    void updateClientSettings(patch).then(refresh, () =>
      setError("Could not save the quick message shortcut."),
    );
  };

  const recorder = useSnapShotShortcutRecorder({
    shortcut,
    disabled: !enabled,
    allowModifierPairs: false,
    name: "quick message",
    ...(quickMessage ? { suppressShortcut: quickMessage.setShortcutSuppressed } : {}),
    onStart: () => setError(null),
    onError: setError,
    onRecord: (next) => {
      if (isModifierPairShortcut(next)) return;
      // A global shortcut takes the keys from T3 Code too, so it would silently replace these.
      const conflict = snapShotKeybindingConflict(next, keybindings);
      if (conflict) {
        setError(`${commandLabel(conflict)} already uses this shortcut.`);
        return;
      }
      if (snapShotEnabled && sameSnapShotShortcut(next, snapShotShortcut)) {
        setError("Snap Shot already uses this shortcut.");
        return;
      }
      save({ quickMessageShortcut: next });
    },
  });

  if (!quickMessage) return null;
  const message = error ?? (enabled ? state?.message : null) ?? null;

  return (
    <SettingsRow
      {...searchableSetting("quick-message")}
      description="Press a shortcut in any app to open a floating composer that starts a new thread."
      status={message ? <span className="text-destructive">{message}</span> : undefined}
      control={
        <div className="flex items-center gap-2">
          {enabled ? recorder.input : null}
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => save({ quickMessageEnabled: Boolean(checked) })}
            aria-label="Quick message"
          />
        </div>
      }
    />
  );
}

const NEW_DRAFT_AFTER_OPTIONS = [
  { value: "0", minutes: 0, label: "Every time" },
  { value: "1", minutes: 1, label: "After 1 minute" },
  { value: "5", minutes: 5, label: "After 5 minutes" },
  { value: "15", minutes: 15, label: "After 15 minutes" },
  { value: "60", minutes: 60, label: "After 1 hour" },
  { value: "never", minutes: null, label: "Never" },
] as const;

function newDraftAfterLabel(minutes: number | null): string {
  const option = NEW_DRAFT_AFTER_OPTIONS.find((candidate) => candidate.minutes === minutes);
  return option?.label ?? `After ${minutes} minutes`;
}

export function QuickMessageNewDraftSettingsRow() {
  const enabled = useClientSettings((settings) => settings.quickMessageEnabled);
  const minutes = useClientSettings((settings) => settings.quickMessageNewDraftAfterMinutes);
  if (!window.desktopBridge?.quickMessage || !enabled) return null;
  const defaultMinutes = DEFAULT_CLIENT_SETTINGS.quickMessageNewDraftAfterMinutes;

  return (
    <SettingsRow
      {...searchableSetting("quick-message-new-draft")}
      description="How long the floating window stays hidden before the shortcut opens a new draft instead of the last one. Open in main always starts a new draft."
      resetAction={
        minutes !== defaultMinutes ? (
          <SettingResetButton
            label="new draft timing"
            onClick={() =>
              void updateClientSettings({ quickMessageNewDraftAfterMinutes: defaultMinutes })
            }
          />
        ) : null
      }
      control={
        <Select
          value={minutes === null ? "never" : String(minutes)}
          onValueChange={(value) => {
            const option = NEW_DRAFT_AFTER_OPTIONS.find((candidate) => candidate.value === value);
            if (option)
              void updateClientSettings({ quickMessageNewDraftAfterMinutes: option.minutes });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Start a new draft">
            <SelectValue>{newDraftAfterLabel(minutes)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {NEW_DRAFT_AFTER_OPTIONS.map((option) => (
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
