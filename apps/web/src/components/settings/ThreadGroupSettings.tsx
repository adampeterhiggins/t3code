import { SidebarThreadView } from "@t3tools/contracts/settings";

import { useThreadGroups } from "../../hooks/useThreadGroups";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { ThreadGroupIcon } from "../sidebar/ThreadGroupIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Per-group row style and whether a group's page lists its settled threads. */
export function ThreadGroupSettingsSection() {
  const { groups, saveGroup } = useThreadGroups();
  const names = Object.keys(groups).toSorted((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  return (
    <SettingsSection {...searchableSetting("sidebar-thread-groups")}>
      {names.map((name) => {
        const group = groups[name]!;
        const { showSettled: _showSettled, view: _view, ...rest } = group;
        const withView = group.view === undefined ? rest : { ...rest, view: group.view };
        const withSettled = group.showSettled === false ? { ...rest, showSettled: false } : rest;
        return (
          <SettingsRow
            key={name}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <ThreadGroupIcon style={group} />
                <span className="truncate">{name}</span>
              </span>
            }
            control={
              <div className="flex items-center gap-4">
                <Select
                  value={group.view ?? "default"}
                  onValueChange={(value) =>
                    saveGroup({
                      name,
                      group:
                        value === "card" || value === "slim"
                          ? { ...withSettled, view: value }
                          : withSettled,
                    })
                  }
                >
                  <SelectTrigger aria-label={`Rows in ${name}`} size="sm">
                    <SelectValue>
                      {`${THREAD_GROUP_VIEW_LABELS[group.view ?? "default"]} rows`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {(["default", ...SidebarThreadView.literals] as const).map((view) => (
                      <SelectItem key={view} value={view}>
                        {`${THREAD_GROUP_VIEW_LABELS[view]} rows`}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
                  Show settled
                  <Switch
                    checked={group.showSettled !== false}
                    onCheckedChange={(checked) =>
                      saveGroup({
                        name,
                        group: checked ? withView : { ...withView, showSettled: false },
                      })
                    }
                  />
                </label>
              </div>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
