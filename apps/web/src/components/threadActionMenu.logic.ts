import type { ContextMenuItem } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import type { ThreadSubscriptionLimitGuard } from "@t3tools/client-runtime/state/subscription-limit-guard";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type ThreadActionMenuId =
  | "name-tab-group"
  | "new-tab"
  | "close-tab"
  | "open-in-split"
  | "close-split"
  | "find"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "subscription-limit"
  | "subscription-limit:on"
  | "subscription-limit:off"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "hide"
  | "unhide"
  | "move-to-group"
  | "move-to-group:new"
  | "move-to-group:remove"
  | `move-to-group:name:${string}`
  | "move-to-project"
  | `move-to-project:${string}`
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "restart-session"
  | "share-guest"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "export-transcript"
  | "link"
  | "link-linear-issue"
  | "link-slack-thread"
  | "link-discord-thread"
  | "link-notion-page"
  | "link-google-file"
  | "link-granola-note"
  | "link-github-issue"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(
  options: {
    readonly hasPath: boolean;
    readonly hasBranch: boolean;
    readonly hasProject: boolean;
  },
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [
              {
                id: "copy-path" as const,
                label: resolve(msg("Path", { $context: "copy the file path" })),
                icon: "folder",
              },
            ]
          : []),
        ...(options.hasBranch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
      ],
    },
    ...(options.hasProject
      ? [
          {
            id: "project-settings" as const,
            label: resolve(msg("Project settings")),
            icon: "settings",
          },
        ]
      : []),
    {
      id: "discard",
      label: resolve(msg("Discard draft")),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  /**
   * Chat tabs for this thread. Null where the environment has no tabs; `canClose` is false for
   * a thread with no sibling tab, where closing would just be archiving.
   */
  readonly tabs: { readonly canClose: boolean } | null;
  /**
   * Split view for this thread: "open" shows it beside the routed chat, "close" ends the split
   * it is in. Null where neither applies, such as the routed chat outside a split.
   */
  readonly split?: "open" | "close" | null;
  /**
   * Offers restarting the thread's agent session. Off for the chat header, whose menu acts on a
   * tab group's root thread rather than the open tab.
   */
  readonly canRestartSession?: boolean;
  /** The thread's project is on GitHub, so a GitHub issue can be linked to it. */
  readonly canLinkGitHubIssue?: boolean;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  /** Null where the thread's provider does not offer Stop at subscription limit. */
  readonly subscriptionLimit?: ThreadSubscriptionLimitGuard | null;
  readonly isSnoozed: boolean;
  readonly isHidden: boolean;
  /** The thread's sidebar group, and every group name it could move to. */
  readonly groupName: string | null;
  readonly groupNames: readonly string[];
  /**
   * Projects in the thread's environment it could move to. Null where the server can't move
   * threads, or the thread can't leave its project (a subagent).
   */
  readonly moveTargets?: ReadonlyArray<{ readonly id: string; readonly label: string }> | null;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    /** Server understands thread.hidden.set. */
    readonly hiding: boolean;
    /** Server understands thread.group.set. */
    readonly groups: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Integrations the thread's environment has turned on, which add their "Link …" items. */
  readonly integrations?: {
    readonly slack: boolean;
    readonly discord: boolean;
    readonly notion: boolean;
    readonly google?: boolean;
    readonly granola: boolean;
  };
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "open-in-split",
    "close-split",
    "export-transcript",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.tabs
      ? [{ id: "new-tab" as const, label: resolve(msg("New tab")), icon: "plus" }]
      : []),
    ...(state.split === "open"
      ? [
          {
            id: "open-in-split" as const,
            label: resolve(msg("Open in split view")),
            icon: "columns-2",
          },
        ]
      : state.split === "close"
        ? [
            {
              id: "close-split" as const,
              label: resolve(msg("Close split view")),
              icon: "columns-2",
            },
          ]
        : []),
    ...(state.canFind
      ? [{ id: "find" as const, label: resolve(msg("Find in thread")), icon: "text-search" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: resolve(msg("New thread on {branch}", { branch: state.branch })),
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: resolve(msg("Unpin thread")), icon: "pin-off" }
            : { id: "pin" as const, label: resolve(msg("Pin thread")), icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? {
                id: "unsettle" as const,
                label: resolve(msg("Un-settle thread")),
                icon: "circle-check",
              }
            : { id: "settle" as const, label: resolve(msg("Settle thread")), icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: resolve(msg("Wake thread")), icon: "clock" }
            : {
                id: "snooze" as const,
                label: resolve(msg("Snooze", { $context: "verb, snooze the thread" })),
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: preset.label,
                    detail: preset.whenLabel,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: resolve(msg("Custom…")),
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    ...(state.supports.hiding
      ? [
          state.isHidden
            ? { id: "unhide" as const, label: resolve(msg("Unhide thread")), icon: "eye" }
            : { id: "hide" as const, label: resolve(msg("Hide thread")), icon: "eye-off" },
        ]
      : []),
    ...(state.supports.groups
      ? [
          {
            id: "move-to-group" as const,
            label: resolve(msg("Move to group")),
            icon: "folder",
            children: [
              ...state.groupNames.map((name) => ({
                id: `move-to-group:name:${name}` as const,
                label: name,
                checked: name === state.groupName,
              })),
              {
                id: "move-to-group:new" as const,
                label: resolve(msg("New group…")),
                separatorBefore: state.groupNames.length > 0,
              },
              ...(state.groupName === null
                ? []
                : [
                    {
                      id: "move-to-group:remove" as const,
                      label: resolve(msg("Remove from group")),
                    },
                  ]),
            ],
          },
        ]
      : []),
    ...(state.moveTargets
      ? [
          {
            id: "move-to-project" as const,
            label: resolve(msg("Move to project")),
            icon: "folder-input",
            // Moving detaches the agent, which would end a running turn.
            disabled: state.isRunning || state.moveTargets.length === 0,
            children: state.moveTargets.map((project) => ({
              id: `move-to-project:${project.id}` as const,
              label: project.label,
            })),
          },
        ]
      : []),
    { id: "rename", label: resolve(msg("Rename thread")), icon: "pencil", separatorBefore: true },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle
              ? resolve(msg("Regenerating…"))
              : resolve(msg("Regenerate title")),
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: resolve(msg("Mark unread")), icon: "mail-open" },
    ...(state.canRestartSession
      ? [
          {
            id: "restart-session" as const,
            label: resolve(msg("Restart agent session")),
            icon: "rotate-ccw",
          },
        ]
      : []),
    ...(state.canShareWithGuest
      ? [{ id: "share-guest" as const, label: resolve(msg("Share with guest")), icon: "user-plus" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? resolve(msg("Show all projects"))
              : resolve(msg("Filter by {project}", { project: state.projectFilter.label })),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: resolve(msg("Turn into project")),
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: resolve(msg("Auto-settle behavior")),
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: resolve(msg("Follow settings")),
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: resolve(msg("Never", { $context: "auto-settle never" })),
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    ...(state.subscriptionLimit
      ? [
          {
            id: "subscription-limit" as const,
            label: resolve(msg("Stop at subscription limit")),
            icon: "gauge",
            children: [
              ...(state.subscriptionLimit.enforcedByApp
                ? [
                    {
                      id: "subscription-limit" as const,
                      label: resolve(msg("On for all threads in Settings")),
                      header: true,
                    },
                  ]
                : []),
              {
                id: "subscription-limit:on" as const,
                label: resolve(msg("On", { $context: "setting state, turned on" })),
                checked: state.subscriptionLimit.enabled,
              },
              {
                id: "subscription-limit:off" as const,
                label: resolve(msg("Off", { $context: "setting state, turned off" })),
                checked: !state.subscriptionLimit.enabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      separatorBefore: true,
      children: [
        {
          id: "copy-path",
          label: resolve(msg("Path", { $context: "copy the file path" })),
          icon: "folder",
        },
        ...(state.branch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
        {
          id: "copy-thread",
          label: resolve(msg("Thread", { $context: "copy the thread contents" })),
          icon: "message-square",
        },
        { id: "copy-thread-id", label: resolve(msg("Thread ID")), icon: "hash" },
      ],
    },
    { id: "export-transcript", label: resolve(msg("Export transcript…")), icon: "download" },
    {
      id: "link",
      label: resolve(msg("Link", { $context: "submenu of things to link to the thread" })),
      icon: "link",
      children: [
        { id: "link-linear-issue", label: resolve(msg("Linear issue…")), icon: "linear" },
        ...(state.canLinkGitHubIssue
          ? [
              {
                id: "link-github-issue" as const,
                label: resolve(msg("GitHub issue…")),
                icon: "github",
              },
            ]
          : []),
        ...(state.integrations?.slack
          ? [
              {
                id: "link-slack-thread" as const,
                label: resolve(msg("Slack thread…")),
                icon: "slack",
              },
            ]
          : []),
        ...(state.integrations?.discord
          ? [
              {
                id: "link-discord-thread" as const,
                label: resolve(msg("Discord thread…")),
                icon: "discord",
              },
            ]
          : []),
        ...(state.integrations?.notion
          ? [
              {
                id: "link-notion-page" as const,
                label: resolve(msg("Notion page…")),
                icon: "notion",
              },
            ]
          : []),
        ...(state.integrations?.google
          ? [
              {
                id: "link-google-file" as const,
                label: resolve(msg("Google page…")),
                icon: "google",
              },
            ]
          : []),
        ...(state.integrations?.granola
          ? [
              {
                id: "link-granola-note" as const,
                label: resolve(msg("Granola note…")),
                icon: "granola",
              },
            ]
          : []),
      ],
    },
    { id: "project-settings", label: resolve(msg("Project settings")), icon: "settings" },
    ...(state.tabs?.canClose
      ? [
          {
            id: "close-tab" as const,
            label: resolve(msg("Close tab")),
            icon: "x",
            disabled: state.isRunning,
            separatorBefore: true,
          },
        ]
      : []),
    {
      id: "archive",
      label: resolve(msg("Archive thread")),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: !state.tabs?.canClose,
    },
    {
      id: "delete",
      label: resolve(msg("Delete", { $context: "verb, delete the thread" })),
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}

/**
 * Every sidebar group, sorted for menus: the saved groups, plus any name a thread is in that was
 * never saved (an agent can move a thread into a new name).
 */
export function collectThreadGroupNames(
  threads: Iterable<{ readonly groupName?: string | null }>,
  savedGroupNames: Iterable<string> = [],
): string[] {
  const names = new Set<string>(savedGroupNames);
  for (const thread of threads) if (thread.groupName) names.add(thread.groupName);
  return [...names].toSorted((left, right) => left.localeCompare(right));
}

/**
 * What a Move to group pick does: move into a named group, leave the current one (null), or ask
 * for a new group's name first. Undefined for any other menu id.
 */
export function resolveThreadGroupMenuPick(
  id: ThreadActionMenuId,
): { readonly groupName: string | null } | "new" | undefined {
  if (id === "move-to-group:new") return "new";
  if (id === "move-to-group:remove") return { groupName: null };
  const prefix = "move-to-group:name:";
  return id.startsWith(prefix) ? { groupName: id.slice(prefix.length) } : undefined;
}

/** The destination project id of a Move to project pick, or undefined for any other menu id. */
export function resolveThreadProjectMenuPick(id: ThreadActionMenuId): string | undefined {
  const prefix = "move-to-project:";
  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
}
