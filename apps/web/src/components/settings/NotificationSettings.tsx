import { useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread needs you, finishes, or fails. Applies to this device while T3 Code is open."
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                );
                return;
              }
              setRequesting(true);
              try {
                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                  setPermissionMessage(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  );
                  return;
                }
              } catch {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Sound only is still available.",
                );
                return;
              } finally {
                setRequesting(false);
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const NOTIFICATION_EVENTS = Object.keys(NOTIFICATION_EVENT_LABELS) as Array<
  keyof typeof NOTIFICATION_EVENT_LABELS
>;

/** Which events raise system alerts, sounds, and in-app toasts on this device. */
export function NotificationEventSettings() {
  const muted = useClientSettings((settings) => settings.mutedNotificationEvents);
  const updateSettings = useUpdateClientSettings();
  const enabledCount = NOTIFICATION_EVENTS.length - muted.length;

  return (
    <SettingsRow
      {...searchableSetting("notification-events")}
      description="Choose which events alert you. Mute a single project from its project settings."
      control={
        <Menu>
          <MenuTrigger
            render={<Button type="button" variant="outline" size="sm" />}
            aria-label="Notification events"
          >
            {enabledCount === NOTIFICATION_EVENTS.length
              ? "All events"
              : enabledCount === 0
                ? "No events"
                : `${enabledCount} of ${NOTIFICATION_EVENTS.length} events`}
          </MenuTrigger>
          <MenuPopup align="end">
            {NOTIFICATION_EVENTS.map((event) => (
              <MenuCheckboxItem
                key={event}
                checked={!muted.includes(event)}
                onCheckedChange={(checked) =>
                  updateSettings({
                    mutedNotificationEvents: checked
                      ? muted.filter((candidate) => candidate !== event)
                      : [...muted, event],
                  })
                }
              >
                {NOTIFICATION_EVENT_LABELS[event]}
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu>
      }
    />
  );
}
