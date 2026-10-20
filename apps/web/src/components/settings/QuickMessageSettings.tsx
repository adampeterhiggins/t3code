import { isModifierPairShortcut, type DesktopQuickMessageState } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { sameSnapShotShortcut, snapShotKeybindingConflict } from "../../lib/snapShotShortcut";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Switch } from "../ui/switch";
import { commandLabel } from "./KeybindingsSettings.logic";
import { SettingsRow } from "./settingsLayout";
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
