import {
  formatProviderSkillDisplayName,
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import {
  type EnvironmentId,
  type ProjectEntry,
  type ProviderDriverKind,
  type PullRequestContextMetadata,
  type ScopedThreadRef,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
  type SlackMessageSummary,
  type ThreadId,
} from "@t3tools/contracts";
import {
  BlocksIcon,
  FolderGit2Icon,
  FolderIcon,
  MessagesSquareIcon,
  PackageIcon,
  SettingsIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { GitHubIcon, LinearIcon, NotionIcon, SlackIcon } from "../Icons";
import { memo, useCallback, useLayoutEffect, useRef } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Kbd } from "../ui/kbd";
import { Command, CommandGroup, CommandItem, CommandList } from "../ui/command";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { ComposerBanner } from "./ComposerBanner";
import {
  GITHUB_ISSUE_STATE_PRESENTATION,
  GitHubIssueHoverPreview,
} from "./GitHubIssueHoverPreview";
import { LinearIssueHoverPreview } from "./LinearIssueHoverPreview";
import { SourceTabs } from "./SourceTabs";
import { resolvePullRequestState } from "../pullRequest/pullRequestPresentation";
import { formatRelativeTimeLabel } from "~/timestampFormat";

export type ComposerCommandItem =
  | { id: string; type: "notion-page"; pageId: string; label: string; description: string }
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "thread-tab";
      threadId: ThreadId;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "pull-request";
      pullRequest: PullRequestContextMetadata;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "linear-issue";
      issueId: string;
      label: string;
      description: string;
      assigneeName: string | null;
      stateName: string;
    }
  | {
      id: string;
      type: "github-issue";
      url: string;
      label: string;
      description: string;
      authorLogin: string | null;
      state: "open" | "closed";
    }
  | {
      id: string;
      type: "slack-message";
      message: SlackMessageSummary;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "repository";
      nameWithOwner: string;
      remoteUrl: string;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "thread";
      thread: ScopedThreadRef;
      label: string;
      description: string;
    };

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  listId: string;
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  emptyStateText?: string;
  /** Replaces the trigger's default loading text, e.g. for the `#` menu's Linear tab. */
  loadingText?: string;
  /** Tabs over the list, for a trigger that offers more than one kind of item. */
  tabs?: {
    options: ReadonlyArray<{ id: string; label: string }>;
    activeId: string;
    onSelect: (id: string) => void;
  };
  activeItemId: string | null;
  /** Lets Linear and GitHub issue rows fetch their hover preview. */
  environmentId?: EnvironmentId;
  /** Items picked with cmd/ctrl+click. While any are picked, every row shows a checkbox. */
  selection?: {
    itemIds: ReadonlySet<string>;
    onCommit: () => void;
  };
  onHighlightedItemChange: (itemId: string | null) => void;
  /** `toggle` is set for a cmd/ctrl+click, which picks the row instead of choosing it. */
  onSelect: (item: ComposerCommandItem, options: { toggle: boolean }) => void;
}) {
  const selectedCount = props.selection?.itemIds.size ?? 0;
  const listRef = useRef<HTMLDivElement>(null);
  // Only keyboard moves scroll the list. Following the pointer would scroll a half-visible edge
  // row into view, put a new row under the cursor, and creep the list along.
  const pointerHighlightedIdRef = useRef<string | null>(null);
  const { onHighlightedItemChange } = props;
  const highlightFromPointer = useCallback(
    (itemId: string | null) => {
      pointerHighlightedIdRef.current = itemId;
      onHighlightedItemChange(itemId);
    },
    [onHighlightedItemChange],
  );

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    if (props.activeItemId === pointerHighlightedIdRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue, eventDetails) => {
        const itemId = typeof highlightedValue === "string" ? highlightedValue : null;
        if (eventDetails.reason === "pointer") highlightFromPointer(itemId);
        else props.onHighlightedItemChange(itemId);
      }}
    >
      <ComposerBanner.Surface
        ref={listRef}
        className="flex min-h-0 w-full flex-col overflow-hidden pb-(--chat-composer-attachment-overlap) **:data-[slot=scroll-area-scrollbar]:data-[orientation=vertical]:my-4"
        data-composer-command-drawer="true"
      >
        {props.tabs ? <SourceTabs {...props.tabs} className="flex gap-1 px-3 pt-2.5" /> : null}
        {props.items.length > 0 ? (
          <CommandList
            id={props.listId}
            aria-label={props.triggerKind ? LISTBOX_LABEL_BY_TRIGGER[props.triggerKind] : undefined}
            className="max-h-72 min-h-0 scroll-pb-6"
          >
            <CommandGroup>
              {props.items.map((item) => (
                <ComposerCommandMenuItem
                  key={item.id}
                  optionId={composerSuggestionOptionId(props.listId, item.id)}
                  item={item}
                  environmentId={props.environmentId ?? null}
                  triggerKind={props.triggerKind}
                  resolvedTheme={props.resolvedTheme}
                  isActive={props.activeItemId === item.id}
                  isChecked={
                    selectedCount > 0 ? (props.selection?.itemIds.has(item.id) ?? false) : null
                  }
                  onHighlight={highlightFromPointer}
                  onSelect={props.onSelect}
                />
              ))}
            </CommandGroup>
          </CommandList>
        ) : (
          <div className="px-5 pt-3.5 pb-7">
            <p className="text-secondary-label text-xs">
              {props.isLoading
                ? props.loadingText !== undefined
                  ? props.loadingText
                  : props.triggerKind === "skill"
                    ? "Searching workspace skills..."
                    : props.triggerKind === "pull-request"
                      ? "Finding pull request..."
                      : "Searching workspace files..."
                : (props.emptyStateText ??
                  (props.triggerKind === "skill"
                    ? "No skills found. Try / to browse provider commands."
                    : props.triggerKind === "path"
                      ? "No matching files or folders."
                      : "No matching command."))}
            </p>
          </div>
        )}
        {props.selection && selectedCount > 0 ? (
          <div className="flex items-center gap-2 px-5 pt-1 pb-2.5 text-secondary-label text-xs">
            <span className="min-w-0 flex-1 truncate">
              {selectedCount} selected · <Kbd>Enter</Kbd> to attach, <Kbd>Esc</Kbd> to cancel
            </span>
            <Button
              size="micro"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={props.selection.onCommit}
            >
              Attach {selectedCount}
            </Button>
          </div>
        ) : null}
      </ComposerBanner.Surface>
    </Command>
  );
});

type LinearIssueCommandItem = Extract<ComposerCommandItem, { type: "linear-issue" }>;

/** Fixed-width columns so identifiers, assignees, and statuses line up down the list. */
function LinearIssueRow(props: {
  item: LinearIssueCommandItem;
  environmentId: EnvironmentId | null;
}) {
  const row = (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="w-20 shrink-0 truncate font-medium font-sans">{props.item.label}</span>
      <span className="min-w-0 flex-1 truncate text-secondary-label">{props.item.description}</span>
      <span className="w-28 shrink-0 truncate text-secondary-label">
        {props.item.assigneeName ?? "Unassigned"}
      </span>
      <span className="w-24 shrink-0 truncate text-secondary-label">{props.item.stateName}</span>
    </span>
  );
  return props.environmentId === null ? (
    row
  ) : (
    <LinearIssueHoverPreview
      environmentId={props.environmentId}
      issueId={props.item.issueId}
      trigger={row}
    />
  );
}

type GitHubIssueCommandItem = Extract<ComposerCommandItem, { type: "github-issue" }>;

/** Fixed-width columns so numbers, authors, and states line up down the list. */
function GitHubIssueRow(props: {
  item: GitHubIssueCommandItem;
  environmentId: EnvironmentId | null;
}) {
  const state = GITHUB_ISSUE_STATE_PRESENTATION[props.item.state];
  const row = (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="w-14 shrink-0 truncate font-medium font-sans tabular-nums">
        {props.item.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-secondary-label">{props.item.description}</span>
      <span className="w-24 shrink-0 truncate text-secondary-label">
        {props.item.authorLogin ?? ""}
      </span>
      <span className={cn("w-14 shrink-0 truncate", state.toneClassName)}>{state.label}</span>
    </span>
  );
  return props.environmentId === null ? (
    row
  ) : (
    <GitHubIssueHoverPreview
      environmentId={props.environmentId}
      url={props.item.url}
      trigger={row}
    />
  );
}

type SlackMessageCommandItem = Extract<ComposerCommandItem, { type: "slack-message" }>;

/** Fixed-width columns so channels and times line up down the list. */
function SlackMessageCommandRow(props: { item: SlackMessageCommandItem }) {
  const { message } = props.item;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="w-28 shrink-0 truncate font-medium font-sans">{message.channelLabel}</span>
      <span className="min-w-0 flex-1 truncate text-secondary-label">
        <span className="text-foreground">{message.authorName}</span> · {message.text}
      </span>
      <span className="w-16 shrink-0 truncate text-end text-secondary-label">
        {formatRelativeTimeLabel(message.postedAt)}
      </span>
    </span>
  );
}

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  optionId: string;
  item: ComposerCommandItem;
  environmentId: EnvironmentId | null;
  triggerKind: ComposerTriggerKind | null;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  /** `null` outside multi-select, where rows show no checkbox. */
  isChecked: boolean | null;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem, options: { toggle: boolean }) => void;
}) {
  const skillSourceKind =
    props.item.type === "skill" ? resolveProviderSkillSourceKind(props.item.skill) : null;
  const isSlashSkill =
    props.triggerKind === "slash-command" && props.item.type === "skill" ? props.item.skill : null;
  const pullRequestPresentation =
    props.item.type === "pull-request" ? resolvePullRequestState(props.item.pullRequest) : null;

  return (
    <CommandItem
      render={<div id={props.optionId} />}
      aria-selected={props.isActive}
      value={props.item.id}
      data-composer-item-id={props.item.id}
      active={props.isActive}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={(event) => {
        props.onSelect(props.item, { toggle: event.metaKey || event.ctrlKey });
      }}
    >
      {props.isChecked !== null ? (
        <span aria-hidden="true" className="pointer-events-none flex shrink-0">
          <Checkbox checked={props.isChecked} tabIndex={-1} />
        </span>
      ) : null}
      {props.item.type === "path" ? (
        <PierreEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "thread-tab" ? (
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "linear-issue" ? (
        <LinearIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "github-issue" ? (
        <GitHubIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "notion-page" ? (
        <NotionIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "slack-message" ? (
        <SlackIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "repository" ? (
        <FolderGit2Icon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "thread" ? (
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {pullRequestPresentation ? (
        <pullRequestPresentation.Icon
          role="img"
          aria-label={pullRequestPresentation.label}
          className={cn("size-4 shrink-0", pullRequestPresentation.toneClassName)}
        />
      ) : null}
      {props.item.type === "linear-issue" ? (
        <LinearIssueRow item={props.item} environmentId={props.environmentId} />
      ) : props.item.type === "github-issue" ? (
        <GitHubIssueRow item={props.item} environmentId={props.environmentId} />
      ) : props.item.type === "slack-message" ? (
        <SlackMessageCommandRow item={props.item} />
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 max-w-[45%] shrink-0 truncate font-sans text-xs font-medium">
            {isSlashSkill ? (
              <>
                <span className="text-secondary-label">/skill:</span>
                {formatProviderSkillDisplayName(isSlashSkill)}
              </>
            ) : (
              props.item.label
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-secondary-label text-xs">
            {props.item.description}
          </span>
          {skillSourceKind ? (
            <SkillSourceBadge
              kind={skillSourceKind}
              showSkillSuffix={props.triggerKind === "skill"}
            />
          ) : null}
        </span>
      )}
    </CommandItem>
  );
});

export function composerSuggestionOptionId(listId: string, itemId: string): string {
  // JSON escapes lone UTF-16 surrogates before URI encoding without losing identity.
  return `${listId}-${encodeURIComponent(JSON.stringify(itemId))}`;
}

const LISTBOX_LABEL_BY_TRIGGER: Record<ComposerTriggerKind, string> = {
  path: "Files and folders",
  "pull-request": "Pull requests",
  "slash-command": "Commands",
  skill: "Skills",
};

const SKILL_SOURCE_ICON_BY_KIND: Record<ProviderSkillSourceKind, LucideIcon> = {
  app: BlocksIcon,
  repo: FolderIcon,
  project: FolderIcon,
  personal: UserRoundIcon,
  system: SettingsIcon,
  other: PackageIcon,
};

const SKILL_SOURCE_LABEL_BY_KIND: Record<ProviderSkillSourceKind, string> = {
  app: "App",
  repo: "Repo",
  project: "Project",
  personal: "Personal",
  system: "System",
  other: "Provider",
};

function SkillSourceBadge(props: { kind: ProviderSkillSourceKind; showSkillSuffix: boolean }) {
  const Icon = SKILL_SOURCE_ICON_BY_KIND[props.kind];
  return (
    <Badge className="ms-auto" variant="secondary">
      <Icon aria-hidden="true" className="text-current" />
      {SKILL_SOURCE_LABEL_BY_KIND[props.kind]}
      {props.showSkillSuffix ? " Skill" : null}
    </Badge>
  );
}
