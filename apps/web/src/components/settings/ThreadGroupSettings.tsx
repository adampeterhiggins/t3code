import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { SidebarThreadView } from "@t3tools/contracts/settings";
import { EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useQuietThreadShells } from "../../state/entities";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { createSidebarGroupActions } from "../sidebar/groupActions";
import { ThreadGroupIcon } from "../sidebar/ThreadGroupIcon";
import { useSidebarOrganization } from "../sidebar/useSidebarOrganization";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

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
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost-muted"
                      size="icon-sm"
                      aria-label={`Options for ${name}`}
                    />
                  }
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuGroupLabel>Rows</MenuGroupLabel>
                    <MenuRadioGroup
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
                      {(["default", ...SidebarThreadView.literals] as const).map((view) => (
                        <MenuRadioItem key={view} value={view}>
                          {THREAD_GROUP_VIEW_LABELS[view]}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>Settled threads</MenuGroupLabel>
                    <MenuRadioGroup
                      value={group.showSettled === false ? "hide" : "show"}
                      onValueChange={(value) =>
                        saveGroup({
                          name,
                          group: value === "hide" ? { ...withView, showSettled: false } : withView,
                        })
                      }
                    >
                      <MenuRadioItem value="show">Show in group</MenuRadioItem>
                      <MenuRadioItem value="hide">Move to Settled</MenuRadioItem>
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuItem onClick={() => editThreadGroup(name)}>
                    <PencilIcon />
                    Edit group…
                  </MenuItem>
                  <MenuItem variant="destructive" onClick={() => deleteThreadGroup(name)}>
                    <Trash2Icon />
                    Delete group
                  </MenuItem>
                </MenuPopup>
              </Menu>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
