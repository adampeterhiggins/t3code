/**
 * The sidebar header's one filter control. Each narrowing is a row showing its current value
 * and opening a multi-select submenu, the same shape as the pull request filters:
 *
 * - Show: which of live threads, the user's own groups, snoozed, hidden and settled the list
 *   holds. Live threads alone is the default; other picks join as titled sections below them.
 * - Organisations: which repository owners the list is scoped to, by each checkout's remote.
 * - Projects: which projects the list is scoped to. None picked means every project.
 *
 * The trigger carries a count of the narrowings off their default, so a narrowed list is never
 * a mystery.
 */
import {
  AlarmClockIcon,
  BuildingIcon,
  CircleCheckIcon,
  EyeOffIcon,
  FolderIcon,
  LayersIcon,
  ListFilterIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { ThreadGroups } from "@t3tools/contracts/settings";
import type { SidebarPage } from "../Sidebar.logic";
import { ThreadGroupIcon } from "./ThreadGroupIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

/** Stored loosely: groups come and go, so Sidebar.logic's resolveSidebarPages cleans it on read. */
export const SidebarPagesSchema = Schema.Array(Schema.String);

const BUILT_IN_PAGES = {
  threads: { label: "Threads", Icon: ListIcon },
  snoozed: { label: "Snoozed", Icon: AlarmClockIcon },
  hidden: { label: "Hidden", Icon: EyeOffIcon },
  settled: { label: "Settled", Icon: CircleCheckIcon },
} as const;

export function sidebarPageLabel(page: SidebarPage): string {
  return page.startsWith("group:")
    ? page.slice("group:".length)
    : BUILT_IN_PAGES[page as keyof typeof BUILT_IN_PAGES].label;
}

/** A page's glyph: the built-in icon, or a group's own icon and accent. */
function SidebarPageIcon(props: { page: SidebarPage; groupStyles: ThreadGroups }) {
  if (props.page.startsWith("group:")) {
    return <ThreadGroupIcon style={props.groupStyles[sidebarPageLabel(props.page)]} />;
  }
  const Icon = BUILT_IN_PAGES[props.page as keyof typeof BUILT_IN_PAGES].Icon;
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

/** Past this many projects the submenu offers a search field. */
const PROJECT_SEARCH_THRESHOLD = 8;

/** "Only" on the highlighted row: narrow to just that choice. It follows the
 *  label on the same baseline and keeps its width while hidden, so the
 *  trailing count stays in one column on every row. */
function OnlyButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="invisible shrink-0 cursor-pointer text-xs font-medium text-primary in-data-highlighted:visible hover:text-primary/80"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      Only
    </button>
  );
}

function ChoiceLabel(props: { label: string; onOnly: () => void }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="min-w-0 truncate">{props.label}</span>
      <OnlyButton onClick={props.onOnly} />
    </span>
  );
}

function SidebarShowFilter(props: {
  pages: readonly SidebarPage[];
  available: readonly SidebarPage[];
  counts: ReadonlyMap<SidebarPage, number>;
  groupStyles: ThreadGroups;
  onPagesChange: (pages: readonly SidebarPage[]) => void;
  onNewGroup: () => void;
}) {
  const single = props.pages.length === 1 ? props.pages[0]! : null;

  return (
    <MenuSub>
      <MenuSubTrigger>
        {single ? (
          <SidebarPageIcon page={single} groupStyles={props.groupStyles} />
        ) : (
          <LayersIcon aria-hidden className="size-3.5" />
        )}
        <span className="flex-1">Show</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {props.pages.map(sidebarPageLabel).join(", ")}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-44">
        {props.available.map((page) => {
          return (
            <MenuCheckboxItem
              key={page}
              checked={props.pages.includes(page)}
              onCheckedChange={(checked) => {
                const next = props.available.filter((candidate) =>
                  candidate === page ? checked : props.pages.includes(candidate),
                );
                // The list always shows something, so the last page cannot be unpicked.
                if (next.length > 0) props.onPagesChange(next);
              }}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <SidebarPageIcon page={page} groupStyles={props.groupStyles} />
                <ChoiceLabel
                  label={sidebarPageLabel(page)}
                  onOnly={() => props.onPagesChange([page])}
                />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {props.counts.get(page) ?? 0}
                </span>
              </span>
            </MenuCheckboxItem>
          );
        })}
        <MenuSeparator />
        <MenuItem onClick={props.onNewGroup}>
          <span className="flex min-w-0 items-center gap-2">
            <PlusIcon aria-hidden className="size-3.5 shrink-0" />
            New group…
          </span>
        </MenuItem>
      </MenuSubPopup>
    </MenuSub>
  );
}

function SidebarProjectFilter(props: {
  projects: readonly SidebarProjectSnapshot[];
  scopedProjectKeys: readonly string[];
  onScopedProjectKeysChange: (keys: readonly string[]) => void;
  onProjectSettings: (event: ReactMouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  projectBadge: (project: SidebarProjectSnapshot) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const scoped = new Set(props.scopedProjectKeys);
  const visible =
    needle.length === 0
      ? props.projects
      : props.projects.filter((project) => project.displayName.toLowerCase().includes(needle));
  const scopedProjects = props.projects.filter((project) => scoped.has(project.projectKey));
  const single = scopedProjects.length === 1 ? scopedProjects[0]! : null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        {single ? (
          <ProjectFavicon project={single} className="size-3.5" />
        ) : (
          <FolderIcon aria-hidden className="size-3.5" />
        )}
        <span className="flex-1">Projects</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {scopedProjects.length === 0
            ? "All"
            : single
              ? single.displayName
              : `${scopedProjects.length} selected`}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-[min(18rem,var(--available-width))] min-w-56">
        {props.projects.length > PROJECT_SEARCH_THRESHOLD ? (
          <div className="p-1 pb-2">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                size="compact"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
                }}
                placeholder="Search projects"
                aria-label="Search projects"
              />
            </InputGroup>
          </div>
        ) : null}
        {needle.length === 0 ? (
          <MenuCheckboxItem
            checked={scoped.size === 0}
            onCheckedChange={() => props.onScopedProjectKeysChange([])}
          >
            <span className="flex min-w-0 items-center gap-2">
              <LayersIcon aria-hidden className="size-3.5 shrink-0" />
              All projects
            </span>
          </MenuCheckboxItem>
        ) : null}
        {visible.map((project) => (
          <MenuCheckboxItem
            key={project.projectKey}
            checked={scoped.has(project.projectKey)}
            onCheckedChange={(checked) =>
              props.onScopedProjectKeysChange(
                checked
                  ? [...props.scopedProjectKeys, project.projectKey]
                  : props.scopedProjectKeys.filter((key) => key !== project.projectKey),
              )
            }
            onContextMenu={(event) => props.onProjectSettings(event, project)}
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <ProjectFavicon project={project} className="size-3.5 shrink-0" />
              <ChoiceLabel
                label={project.displayName}
                onOnly={() => props.onScopedProjectKeysChange([project.projectKey])}
              />
              {props.projectBadge(project)}
              <Button
                size="icon-xs"
                variant="ghost-muted"
                tabIndex={-1}
                aria-hidden="true"
                title={`Project settings for ${project.displayName}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => props.onProjectSettings(event, project)}
              >
                <SettingsIcon className="size-3.5" />
              </Button>
            </span>
          </MenuCheckboxItem>
        ))}
        {visible.length === 0 ? <MenuItem disabled>No matching projects</MenuItem> : null}
      </MenuSubPopup>
    </MenuSub>
  );
}

export interface SidebarOrganisationOption {
  readonly key: string;
  readonly label: string;
}

function SidebarOrganisationFilter(props: {
  organisations: readonly SidebarOrganisationOption[];
  scopedKeys: readonly string[];
  onScopedKeysChange: (keys: readonly string[]) => void;
}) {
  const scoped = new Set(props.scopedKeys);
  const picked = props.organisations.filter((option) => scoped.has(option.key));
  return (
    <MenuSub>
      <MenuSubTrigger>
        <BuildingIcon aria-hidden className="size-3.5" />
        <span className="flex-1">Organisations</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {picked.length === 0
            ? "All"
            : picked.length === 1
              ? picked[0]!.label
              : `${picked.length} selected`}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-[min(18rem,var(--available-width))] min-w-48">
        <MenuCheckboxItem
          checked={scoped.size === 0}
          onCheckedChange={() => props.onScopedKeysChange([])}
        >
          <span className="flex min-w-0 items-center gap-2">
            <LayersIcon aria-hidden className="size-3.5 shrink-0" />
            All organisations
          </span>
        </MenuCheckboxItem>
        {props.organisations.map((option) => (
          <MenuCheckboxItem
            key={option.key}
            checked={scoped.has(option.key)}
            onCheckedChange={(checked) =>
              props.onScopedKeysChange(
                checked
                  ? [...props.scopedKeys, option.key]
                  : props.scopedKeys.filter((key) => key !== option.key),
              )
            }
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <BuildingIcon aria-hidden className="size-3.5 shrink-0" />
              <ChoiceLabel
                label={option.label}
                onOnly={() => props.onScopedKeysChange([option.key])}
              />
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
}

export function SidebarFilterMenu(props: {
  pages: readonly SidebarPage[];
  availablePages: readonly SidebarPage[];
  pageCounts: ReadonlyMap<SidebarPage, number>;
  groupStyles: ThreadGroups;
  onPagesChange: (pages: readonly SidebarPage[]) => void;
  onNewGroup: () => void;
  organisations: readonly SidebarOrganisationOption[];
  scopedOrganisationKeys: readonly string[];
  onScopedOrganisationKeysChange: (keys: readonly string[]) => void;
  projects: readonly SidebarProjectSnapshot[];
  scopedProjectKeys: readonly string[];
  onScopedProjectKeysChange: (keys: readonly string[]) => void;
  onProjectSettings: (event: ReactMouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  projectBadge: (project: SidebarProjectSnapshot) => ReactNode;
}) {
  const pagesFiltered = !(props.pages.length === 1 && props.pages[0] === "threads");
  const organisationsFiltered = props.scopedOrganisationKeys.length > 0;
  const projectsFiltered = props.scopedProjectKeys.length > 0;
  const activeCount =
    Number(pagesFiltered) + Number(organisationsFiltered) + Number(projectsFiltered);
  const summary = [
    pagesFiltered ? `Showing ${props.pages.map(sidebarPageLabel).join(", ")}` : null,
    organisationsFiltered
      ? `${props.scopedOrganisationKeys.length} ${props.scopedOrganisationKeys.length === 1 ? "organisation" : "organisations"}`
      : null,
    projectsFiltered
      ? `${props.scopedProjectKeys.length} ${props.scopedProjectKeys.length === 1 ? "project" : "projects"}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarHeaderIconButton
            label={activeCount > 0 ? `Filter threads (${summary})` : "Filter threads"}
            tooltip={activeCount > 0 ? summary : "Filter threads"}
            isActive={activeCount > 0}
          />
        }
      >
        <span className="relative flex shrink-0">
          <ListFilterIcon className="size-4" />
          {activeCount > 0 ? (
            <span className="absolute -right-1.5 -bottom-1 min-w-3 rounded-full bg-primary px-0.5 text-center text-3xs leading-3 font-semibold text-primary-foreground tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </span>
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <SidebarShowFilter
          pages={props.pages}
          available={props.availablePages}
          counts={props.pageCounts}
          groupStyles={props.groupStyles}
          onNewGroup={props.onNewGroup}
          onPagesChange={props.onPagesChange}
        />
        {props.organisations.length > 0 ? (
          <SidebarOrganisationFilter
            organisations={props.organisations}
            scopedKeys={props.scopedOrganisationKeys}
            onScopedKeysChange={props.onScopedOrganisationKeysChange}
          />
        ) : null}
        {props.projects.length > 0 ? (
          <SidebarProjectFilter
            projects={props.projects}
            scopedProjectKeys={props.scopedProjectKeys}
            onScopedProjectKeysChange={props.onScopedProjectKeysChange}
            onProjectSettings={props.onProjectSettings}
            projectBadge={props.projectBadge}
          />
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
