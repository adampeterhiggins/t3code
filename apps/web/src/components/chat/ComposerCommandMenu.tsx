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
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
  type ThreadId,
} from "@t3tools/contracts";
import {
  BlocksIcon,
  FolderIcon,
  MessagesSquareIcon,
  PackageIcon,
  SettingsIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { LinearIcon } from "../Icons";
import { memo, useCallback, useLayoutEffect, useRef } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Command, CommandGroup, CommandItem, CommandList } from "../ui/command";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { ComposerBanner } from "./ComposerBanner";
import { LinearIssueHoverPreview } from "./LinearIssueHoverPreview";
import { SourceTabs } from "./SourceTabs";
import { resolvePullRequestState } from "../pullRequest/pullRequestPresentation";

export type ComposerCommandItem =
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
    };

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
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
  /** Lets Linear issue rows fetch their hover preview. */
  environmentId?: EnvironmentId;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
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
          <CommandList className="max-h-72 min-h-0 scroll-pb-6">
            <CommandGroup>
              {props.items.map((item) => (
                <ComposerCommandMenuItem
                  key={item.id}
                  item={item}
                  environmentId={props.environmentId ?? null}
                  triggerKind={props.triggerKind}
                  resolvedTheme={props.resolvedTheme}
                  isActive={props.activeItemId === item.id}
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

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  environmentId: EnvironmentId | null;
  triggerKind: ComposerTriggerKind | null;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const skillSourceKind =
    props.item.type === "skill" ? resolveProviderSkillSourceKind(props.item.skill) : null;
  const isSlashSkill =
    props.triggerKind === "slash-command" && props.item.type === "skill" ? props.item.skill : null;
  const pullRequestPresentation =
    props.item.type === "pull-request" ? resolvePullRequestState(props.item.pullRequest) : null;

  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      active={props.isActive}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "thread-tab" ? (
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
      {props.item.type === "linear-issue" ? (
        <LinearIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
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
          <span className="min-w-0 max-w-[48ch] flex-1 truncate text-left text-secondary-label text-xs">
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
