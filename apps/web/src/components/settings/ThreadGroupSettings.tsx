import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { SidebarThreadView } from "@t3tools/contracts/settings";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useQuietThreadShells } from "../../state/entities";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { createSidebarGroupActions } from "../sidebar/groupActions";
import { ThreadGroupIcon } from "../sidebar/ThreadGroupIcon";
import { useSidebarOrganization } from "../sidebar/useSidebarOrganization";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const SETTLED_LABELS = { show: "Show settled", hide: "Hide settled" } as const;

/** Creates, renames, deletes and configures thread groups. */
export function ThreadGroupSettingsSection() {
  const threads = useQuietThreadShells();
  const { setThreadGroup } = useThreadActions();
  const { threadGroups, saveGroup, deleteGroup, setSidebarPages, setCollapsedPages } =
    useSidebarOrganization(threads);
  const attemptSetGroup = (threadRef: ScopedThreadRef, groupName: string | null) => {
    void (async () => {
      const result = await setThreadGroup(threadRef, groupName);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to move thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const { editThreadGroup, createThreadGroup, deleteThreadGroup } = createSidebarGroupActions({
    threads,
    threadGroups,
    saveGroup,
    deleteGroup,
    setSidebarPages,
    setCollapsedPages,
    attemptSetGroup,
  });
  const names = Object.keys(threadGroups).toSorted((a, b) => a.localeCompare(b));

  return (
    <SettingsSection
      {...searchableSetting("sidebar-thread-groups")}
      headerAction={
        <Button variant="ghost-muted" size="compact" onClick={createThreadGroup}>
          <PlusIcon />
          New group
        </Button>
      }
    >
      {names.length === 0 ? (
        <SettingsRow
          title="No groups yet"
          description="Groups file threads away from your live list."
        />
      ) : null}
      {names.map((name) => {
        const group = threadGroups[name]!;
        const { showSettled: _showSettled, view: _view, ...rest } = group;
        const withView = group.view === undefined ? rest : { ...rest, view: group.view };
        const withSettled = group.showSettled === false ? { ...rest, showSettled: false } : rest;
        const settled = group.showSettled === false ? "hide" : "show";
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
              <div className="flex items-center gap-2">
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
                <Select
                  value={settled}
                  onValueChange={(value) =>
                    saveGroup({
                      name,
                      group: value === "hide" ? { ...withView, showSettled: false } : withView,
                    })
                  }
                >
                  <SelectTrigger aria-label={`Settled threads in ${name}`} size="sm">
                    <SelectValue>{SETTLED_LABELS[settled]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {(["show", "hide"] as const).map((option) => (
                      <SelectItem key={option} value={option}>
                        {SETTLED_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={`Edit group ${name}`}
                  onClick={() => editThreadGroup(name)}
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={`Delete group ${name}`}
                  onClick={() => deleteThreadGroup(name)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
