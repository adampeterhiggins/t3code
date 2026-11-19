import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
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
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        gt(
          "System alerts when a thread needs you, finishes, or fails. Applies to this device while T3 Code is open.",
        )
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
                  gt(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  ),
                );
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  gt(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  ),
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  gt(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  ),
                );
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Thread notifications")}
          >
            <SelectValue>{m(NOTIFICATION_MODE_LABELS[mode])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {m(label)}
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
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const muted = useClientSettings((settings) => settings.mutedNotificationEvents);
  const enabledCount = NOTIFICATION_EVENTS.length - muted.length;

  return (
    <SettingsRow
      {...searchableSetting("notification-events")}
      description={gt(
        "Choose which events alert you. Mute a single project from its project settings.",
      )}
      control={
        <Menu>
          <MenuTrigger
            render={<Button type="button" variant="outline" size="sm" />}
            aria-label={gt("Notification events")}
          >
            {enabledCount === NOTIFICATION_EVENTS.length
              ? gt("All events")
              : enabledCount === 0
                ? gt("No events")
                : gt("{count} of {total} events", {
                    count: enabledCount,
                    total: NOTIFICATION_EVENTS.length,
                  })}
          </MenuTrigger>
          <MenuPopup align="end">
            {NOTIFICATION_EVENTS.map((event) => (
              <MenuCheckboxItem
                key={event}
                checked={!muted.includes(event)}
                onCheckedChange={(checked) =>
                  updateClientSettings({
                    mutedNotificationEvents: checked
                      ? muted.filter((candidate) => candidate !== event)
                      : [...muted, event],
                  })
                }
              >
                {m(NOTIFICATION_EVENT_LABELS[event])}
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu>
      }
    />
  );
}
