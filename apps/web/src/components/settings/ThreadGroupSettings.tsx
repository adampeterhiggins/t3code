import { SidebarThreadView } from "@t3tools/contracts/settings";

import { useThreadGroups } from "../../hooks/useThreadGroups";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { ThreadGroupIcon } from "../sidebar/ThreadGroupIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Per-group row style and whether a group's page lists its settled threads. */
export function ThreadGroupSettingsRow() {
  const { groups, saveGroup } = useThreadGroups();
  const names = Object.keys(groups).toSorted((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  return (
    <SettingsRow
      {...searchableSetting("sidebar-thread-groups")}
      description="How each group's page lists its threads. Default rows follow Grouped threads. With settled threads off, they appear under Settled instead."
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 rounded-lg border bg-muted/24">
        <div className="contents text-xs text-muted-foreground">
          <span className="px-3 pt-2.5 pb-1.5">Group</span>
          <span className="pt-2.5 pb-1.5">Rows</span>
          <span className="pt-2.5 pr-3 pb-1.5">Show settled</span>
        </div>
        {names.map((name) => {
          const group = groups[name]!;
          const { showSettled: _showSettled, view: _view, ...rest } = group;
          const withView = group.view === undefined ? rest : { ...rest, view: group.view };
          const withSettled = group.showSettled === false ? { ...rest, showSettled: false } : rest;
          return (
            <div key={name} role="group" aria-label={name} className="contents">
              <span className="flex min-w-0 items-center gap-2 border-t px-3 py-2 text-sm">
                <ThreadGroupIcon style={group} />
                <span className="truncate">{name}</span>
              </span>
              <span className="border-t py-2">
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
              </span>
              <span className="flex justify-end border-t py-2 pr-3">
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
              </span>
            </div>
          );
        })}
      </div>
    </SettingsRow>
  );
}
