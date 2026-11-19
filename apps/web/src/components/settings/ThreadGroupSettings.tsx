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
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { m as resolveNow } from "../../i18n/messages";
import { useQuietThreadShells } from "../../state/entities";
import { THREAD_GROUP_VIEW_LABELS } from "../ThreadGroupDialog";
import { collectThreadGroupNames } from "../threadActionMenu.logic";
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
import { useSearchableSetting } from "./settingsSearch";
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
      ["pinned", msg("Pinned rows")],
      ["working", msg("Working rows")],
      ["active", msg("Active rows")],
    ],
  },
  {
    ...BUILT_IN_PAGES.automations,
    title: BUILT_IN_PAGES.automations.label,
    views: [["automations", msg("Rows", { $context: "sidebar thread rows" })]],
    settledChoice: true,
  },
  {
    ...BUILT_IN_PAGES.snoozed,
    title: BUILT_IN_PAGES.snoozed.label,
    views: [["snoozed", msg("Rows", { $context: "sidebar thread rows" })]],
  },
  {
    ...BUILT_IN_PAGES.hidden,
    title: BUILT_IN_PAGES.hidden.label,
    views: [["hidden", msg("Rows", { $context: "sidebar thread rows" })]],
  },
  {
    ...BUILT_IN_PAGES.settled,
    title: BUILT_IN_PAGES.settled.label,
    views: [["settled", msg("Rows", { $context: "sidebar thread rows" })]],
  },
];

/** Row style for each built-in page, and where settled automation threads list. */
function BuiltInThreadGroupRows() {
  const gt = useGT();
  const m = useMessages();
  const threadViews = useScopedSettings((settings) => settings.sidebarThreadViews);
  const automationsShowSettled = useScopedSettings((settings) => settings.automationsShowSettled);
  const updateSettings = useUpdateScopedSettings();
  const setViews = (views: Partial<SidebarThreadViews>) =>
    updateSettings({ sidebarThreadViews: { ...threadViews, ...views } });

  return BUILT_IN_GROUPS.map(({ title: titleMessage, Icon, views, settledChoice }) => {
    const title = m(titleMessage);
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
            <SettingResetButton
              ariaLabel={gt("Reset {page} rows to default", { page: title })}
              onClick={() => setViews(defaults)}
            />
          )
        }
        control={
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={gt("Options for {name}", { name: title })}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {views.map(([category, label], index) => (
                <MenuGroup key={category}>
                  {index > 0 ? <MenuSeparator /> : null}
                  <MenuGroupLabel>{m(label)}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={threadViews[category]}
                    onValueChange={(value) => {
                      if (value === "card" || value === "slim") setViews({ [category]: value });
                    }}
                  >
                    {SidebarThreadView.literals.map((view) => (
                      <MenuRadioItem key={view} value={view}>
                        {m(THREAD_GROUP_VIEW_LABELS[view])}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              ))}
              {settledChoice ? (
                <>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>
                      <T>Settled threads</T>
                    </MenuGroupLabel>
                    <MenuRadioGroup
                      value={automationsShowSettled ? "show" : "hide"}
                      onValueChange={(value) =>
                        updateSettings({ automationsShowSettled: value === "show" })
                      }
                    >
                      <MenuRadioItem value="show">
                        <T>
                          Show in <Var>{title}</Var>
                        </T>
                      </MenuRadioItem>
                      <MenuRadioItem value="hide">
                        <T>Move to Settled</T>
                      </MenuRadioItem>
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
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const threads = useQuietThreadShells();
  const { setThreadGroup } = useThreadActions();
  const {
    threadGroups,
    saveGroup,
    deleteGroup,
    setSidebarPages,
    setStoredExcludedPages,
    setCollapsedPages,
  } = useSidebarOrganization(threads);
  const attemptSetGroup = (threadRef: ScopedThreadRef, groupName: string | null) => {
    void (async () => {
      const result = await setThreadGroup(threadRef, groupName);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: resolveNow(msg("Failed to move thread")),
            description:
              error instanceof Error ? error.message : resolveNow(msg("An error occurred.")),
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
    setExcludedPages: setStoredExcludedPages,
    setCollapsedPages,
    attemptSetGroup,
  });
  // Groups like Quick messages exist only as a thread's groupName until first configured.
  const names = collectThreadGroupNames(threads, Object.keys(threadGroups));

  return (
    <SettingsSection
      {...searchableSetting("sidebar-thread-groups")}
      headerAction={
        <Button variant="ghost-muted" size="compact" onClick={createThreadGroup}>
          <PlusIcon />
          <T>New group</T>
        </Button>
      }
    >
      <BuiltInThreadGroupRows />
      {names.length === 0 ? (
        <SettingsRow
          title={gt("No groups yet")}
          description={gt("Groups file threads away from your live list.")}
        />
      ) : null}
      {names.map((name) => {
        const group = threadGroups[name] ?? {};
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
                      aria-label={gt("Options for {name}", { name })}
                    />
                  }
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuGroupLabel>
                      <T context="sidebar thread rows">Rows</T>
                    </MenuGroupLabel>
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
                          {m(THREAD_GROUP_VIEW_LABELS[view])}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>
                      <T>Settled threads</T>
                    </MenuGroupLabel>
                    <MenuRadioGroup
                      value={group.showSettled === false ? "hide" : "show"}
                      onValueChange={(value) =>
                        saveGroup({
                          name,
                          group: value === "hide" ? { ...withView, showSettled: false } : withView,
                        })
                      }
                    >
                      <MenuRadioItem value="show">
                        <T>Show in group</T>
                      </MenuRadioItem>
                      <MenuRadioItem value="hide">
                        <T>Move to Settled</T>
                      </MenuRadioItem>
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuItem onClick={() => editThreadGroup(name)}>
                    <PencilIcon />
                    <T>Edit group…</T>
                  </MenuItem>
                  <MenuItem variant="destructive" onClick={() => deleteThreadGroup(name)}>
                    <Trash2Icon />
                    <T>Delete group</T>
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
