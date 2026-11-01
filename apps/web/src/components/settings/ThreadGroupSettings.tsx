import { SidebarThreadView } from "@t3tools/contracts/settings";

import { useThreadGroups } from "../../hooks/useThreadGroups";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { ThreadGroupIcon } from "../sidebar/ThreadGroupIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Per-group row style and whether a group's page lists its settled threads. */
export function ThreadGroupSettingsRows() {
  const { groups, saveGroup } = useThreadGroups();
  const names = Object.keys(groups).toSorted((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  return (
    <>
      <SettingsRow
        {...searchableSetting("sidebar-thread-groups")}
        description="Choose rows and settled threads for each group's page. Default rows follow Grouped threads above. With Settled off, that group's settled threads appear under Settled instead."
      />
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
              <div className="flex items-center gap-3">
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
                    <SelectValue>{THREAD_GROUP_VIEW_LABELS[group.view ?? "default"]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {(["default", ...SidebarThreadView.literals] as const).map((view) => (
                      <SelectItem key={view} value={view}>
                        {THREAD_GROUP_VIEW_LABELS[view]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Settled
                  <Switch
                    checked={group.showSettled !== false}
                    onCheckedChange={(checked) =>
                      saveGroup({
                        name,
                        group: checked ? withView : { ...withView, showSettled: false },
                      })
                    }
                    aria-label={`Show settled threads in ${name}`}
                  />
                </label>
              </div>
            }
          />
        );
      })}
    </>
  );
}
