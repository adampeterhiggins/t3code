import { useThreadGroups } from "../../hooks/useThreadGroups";
import { ThreadGroupIcon } from "../sidebar/ThreadGroupIcon";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Per-group switches for whether a group's page lists its settled threads. */
export function ThreadGroupSettledRows() {
  const { groups, saveGroup } = useThreadGroups();
  const names = Object.keys(groups).toSorted((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  return (
    <>
      <SettingsRow
        {...searchableSetting("sidebar-group-settled")}
        description="Choose which groups list their settled threads. When off, that group's settled threads appear under Settled instead."
      />
      {names.map((name) => {
        const { showSettled: _showSettled, ...rest } = groups[name]!;
        return (
          <SettingsRow
            key={name}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <ThreadGroupIcon style={groups[name]} />
                <span className="truncate">{name}</span>
              </span>
            }
            control={
              <Switch
                checked={groups[name]!.showSettled !== false}
                onCheckedChange={(checked) =>
                  saveGroup({ name, group: checked ? rest : { ...rest, showSettled: false } })
                }
                aria-label={`Show settled threads in ${name}`}
              />
            }
          />
        );
      })}
    </>
  );
}
