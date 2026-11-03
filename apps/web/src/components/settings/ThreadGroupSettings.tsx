import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  SidebarThreadView,
  type SidebarThreadViews,
} from "@t3tools/contracts/settings";
import { EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useQuietThreadShells } from "../../state/entities";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { createSidebarGroupActions } from "../sidebar/groupActions";
import { BUILT_IN_PAGES } from "../sidebar/SidebarFilterMenu";
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
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type ThreadViewCategory = keyof SidebarThreadViews;

const BUILT_IN_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly Icon: typeof EllipsisIcon;
  readonly views: ReadonlyArray<readonly [ThreadViewCategory, string]>;
  /** Offers the Settled threads choice that `automationsShowSettled` stores. */
  readonly settledChoice?: true;
}> = [
  {
    ...BUILT_IN_PAGES.threads,
    title: BUILT_IN_PAGES.threads.label,
    views: [
      ["pinned", "Pinned rows"],
      ["working", "Working rows"],
      ["active", "Active rows"],
    ],
  },
  {
    ...BUILT_IN_PAGES.automations,
    title: BUILT_IN_PAGES.automations.label,
    views: [["automations", "Rows"]],
    settledChoice: true,
  },
  { ...BUILT_IN_PAGES.snoozed, title: BUILT_IN_PAGES.snoozed.label, views: [["snoozed", "Rows"]] },
  { ...BUILT_IN_PAGES.hidden, title: BUILT_IN_PAGES.hidden.label, views: [["hidden", "Rows"]] },
  { ...BUILT_IN_PAGES.settled, title: BUILT_IN_PAGES.settled.label, views: [["settled", "Rows"]] },
];

/** Row style for each built-in page, and where settled automation threads list. */
function BuiltInThreadGroupRows() {
  const threadViews = useScopedSettings((settings) => settings.sidebarThreadViews);
  const automationsShowSettled = useScopedSettings((settings) => settings.automationsShowSettled);
  const updateSettings = useUpdateScopedSettings();
  const setViews = (views: Partial<SidebarThreadViews>) =>
    updateSettings({ sidebarThreadViews: { ...threadViews, ...views } });

  return BUILT_IN_GROUPS.map(({ title, Icon, views, settledChoice }) => {
    const defaults: Partial<SidebarThreadViews> = Object.fromEntries(
      views.map(([category]) => [category, DEFAULT_UNIFIED_SETTINGS.sidebarThreadViews[category]]),
    );
    const isDefault = views.every(([category]) => threadViews[category] === defaults[category]);
    return (
      <SettingsRow
        key={title}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{title}</span>
          </span>
        }
        resetAction={
          isDefault ? undefined : (
            <SettingResetButton label={`${title} rows`} onClick={() => setViews(defaults)} />
          )
        }
        control={
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost-muted" size="icon-sm" aria-label={`Options for ${title}`} />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {views.map(([category, label], index) => (
                <MenuGroup key={category}>
                  {index > 0 ? <MenuSeparator /> : null}
                  <MenuGroupLabel>{label}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={threadViews[category]}
                    onValueChange={(value) => {
                      if (value === "card" || value === "slim") setViews({ [category]: value });
                    }}
                  >
                    {SidebarThreadView.literals.map((view) => (
                      <MenuRadioItem key={view} value={view}>
                        {THREAD_GROUP_VIEW_LABELS[view]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              ))}
              {settledChoice ? (
                <>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>Settled threads</MenuGroupLabel>
                    <MenuRadioGroup
                      value={automationsShowSettled ? "show" : "hide"}
                      onValueChange={(value) =>
                        updateSettings({ automationsShowSettled: value === "show" })
                      }
                    >
                      <MenuRadioItem value="show">Show in {title}</MenuRadioItem>
                      <MenuRadioItem value="hide">Move to Settled</MenuRadioItem>
                    </MenuRadioGroup>
                  </MenuGroup>
                </>
              ) : null}
            </MenuPopup>
          </Menu>
        }
      />
    );
  });
}

/** Configures the built-in pages' rows, and creates, renames, deletes and configures thread groups. */
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
      <BuiltInThreadGroupRows />
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
                <ThreadGroupIcon style={group} name={name} />
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
