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
 * a mystery. Hovering it opens a preview of those selections, and SidebarFilterPills lists each
 * one under the header with a way to drop it.
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
  XIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useRef, useState } from "react";

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
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
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

/** Rows kept in the hover preview before the rest collapse to a count. */
const FILTER_PREVIEW_ROW_LIMIT = 8;

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

function FilterPreviewSection(props: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="text-3xs font-semibold tracking-widest text-muted-foreground uppercase">
        {props.label}
      </div>
      <ul className="flex flex-col gap-0.5">{props.children}</ul>
    </section>
  );
}

function FilterPreviewName(props: { icon: ReactNode; label: string }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-xs text-popover-foreground">
      <span className="flex size-3.5 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 truncate">{props.label}</span>
    </li>
  );
}

function FilterPreviewMore(props: { count: number }) {
  if (props.count <= 0) return null;
  return <li className="pl-5 text-xs text-muted-foreground">{props.count} more</li>;
}

/** The selections off their default, named, so a narrowed list is readable without opening it. */
function SidebarFilterPreview(props: {
  pages: readonly SidebarPage[];
  groupStyles: ThreadGroups;
  organisations: readonly SidebarOrganisationOption[];
  scopedOrganisationKeys: readonly string[];
  projects: readonly SidebarProjectSnapshot[];
  scopedProjectKeys: readonly string[];
}) {
  const pagesFiltered = !(props.pages.length === 1 && props.pages[0] === "threads");
  const organisationByKey = new Map(props.organisations.map((option) => [option.key, option]));
  const organisations = props.scopedOrganisationKeys.flatMap((key) => {
    const option = organisationByKey.get(key);
    return option ? [option] : [];
  });
  const projectByKey = new Map(props.projects.map((project) => [project.projectKey, project]));
  const projects = props.scopedProjectKeys.flatMap((key) => {
    const project = projectByKey.get(key);
    return project ? [project] : [];
  });
  const visiblePages = props.pages.slice(0, FILTER_PREVIEW_ROW_LIMIT);
  const visibleOrganisations = organisations.slice(0, FILTER_PREVIEW_ROW_LIMIT);
  const visibleProjects = projects.slice(0, FILTER_PREVIEW_ROW_LIMIT);

  return (
    <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto p-2.5">
      {pagesFiltered ? (
        <FilterPreviewSection label="Show">
          {visiblePages.map((page) => (
            <FilterPreviewName
              key={page}
              icon={<SidebarPageIcon page={page} groupStyles={props.groupStyles} />}
              label={sidebarPageLabel(page)}
            />
          ))}
          <FilterPreviewMore count={props.pages.length - visiblePages.length} />
        </FilterPreviewSection>
      ) : null}
      {organisations.length > 0 ? (
        <FilterPreviewSection label="Organisations">
          {visibleOrganisations.map((option) => (
            <FilterPreviewName
              key={option.key}
              icon={<BuildingIcon aria-hidden className="size-3.5" />}
              label={option.label}
            />
          ))}
          <FilterPreviewMore count={organisations.length - visibleOrganisations.length} />
        </FilterPreviewSection>
      ) : null}
      {props.scopedProjectKeys.length > 0 ? (
        <FilterPreviewSection label="Projects">
          {visibleProjects.map((project) => (
            <FilterPreviewName
              key={project.projectKey}
              icon={<ProjectFavicon project={project} className="size-3.5" />}
              label={project.displayName}
            />
          ))}
          <FilterPreviewMore count={props.scopedProjectKeys.length - visibleProjects.length} />
        </FilterPreviewSection>
      ) : null}
    </div>
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
  const label = activeCount > 0 ? `Filter threads (${summary})` : "Filter threads";
  const menuOpenRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const icon = (
    <span className="relative flex shrink-0">
      <ListFilterIcon className="size-4" />
      {activeCount > 0 ? (
        <span className="absolute -right-1.5 -bottom-1 min-w-3 rounded-full bg-primary px-0.5 text-center text-3xs leading-3 font-semibold text-primary-foreground tabular-nums">
          {activeCount}
        </span>
      ) : null}
    </span>
  );
  const button = (
    <SidebarHeaderIconButton
      label={label}
      tooltip={activeCount > 0 ? false : "Filter threads"}
      isActive={activeCount > 0}
    />
  );
  return (
    <Menu
      open={menuOpen}
      onOpenChange={(open) => {
        menuOpenRef.current = open;
        setMenuOpen(open);
        if (open) setPreviewOpen(false);
      }}
    >
      {/* One trigger shape whatever the count: swapping wrappers when a pick moves the
          count to or from zero would remount the trigger and strand the open menu. */}
      <PreviewCard
        open={previewOpen && !menuOpen && activeCount > 0}
        onOpenChange={(open) => {
          if (menuOpenRef.current) return;
          setPreviewOpen(open);
        }}
      >
        <MenuTrigger render={<PreviewCardTrigger delay={400} closeDelay={120} render={button} />}>
          {icon}
        </MenuTrigger>
        <PreviewCardPopup
          side="bottom"
          align="end"
          sideOffset={8}
          className="w-max min-w-40 max-w-64"
        >
          <SidebarFilterPreview
            pages={props.pages}
            groupStyles={props.groupStyles}
            organisations={props.organisations}
            scopedOrganisationKeys={props.scopedOrganisationKeys}
            projects={props.projects}
            scopedProjectKeys={props.scopedProjectKeys}
          />
        </PreviewCardPopup>
      </PreviewCard>
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

function SidebarFilterPill(props: { icon: ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className="flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border border-sidebar-border pr-0.5 pl-2 text-xs text-sidebar-foreground">
      <span className="flex size-3.5 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 truncate">{props.label}</span>
      <button
        type="button"
        aria-label={`Remove ${props.label} filter`}
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        onClick={props.onRemove}
      >
        <XIcon aria-hidden className="size-3" />
      </button>
    </span>
  );
}

/**
 * One removable pill per selection off its default, under the sidebar header. Renders nothing
 * while the list is unfiltered.
 */
export function SidebarFilterPills(props: {
  pages: readonly SidebarPage[];
  groupStyles: ThreadGroups;
  onPagesChange: (pages: readonly SidebarPage[]) => void;
  organisations: readonly SidebarOrganisationOption[];
  scopedOrganisationKeys: readonly string[];
  onScopedOrganisationKeysChange: (keys: readonly string[]) => void;
  projects: readonly SidebarProjectSnapshot[];
  scopedProjectKeys: readonly string[];
  onScopedProjectKeysChange: (keys: readonly string[]) => void;
}) {
  // Live threads are the default page, so only the extra pages read as filters.
  const pages = props.pages.filter((page) => page !== "threads");
  const organisationByKey = new Map(props.organisations.map((option) => [option.key, option]));
  const organisations = props.scopedOrganisationKeys.flatMap((key) => {
    const option = organisationByKey.get(key);
    return option ? [option] : [];
  });
  const projectByKey = new Map(props.projects.map((project) => [project.projectKey, project]));
  const projects = props.scopedProjectKeys.flatMap((key) => {
    const project = projectByKey.get(key);
    return project ? [project] : [];
  });
  const pillCount = pages.length + organisations.length + projects.length;
  if (pillCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 pt-1.5">
      {pages.map((page) => (
        <SidebarFilterPill
          key={page}
          icon={<SidebarPageIcon page={page} groupStyles={props.groupStyles} />}
          label={sidebarPageLabel(page)}
          onRemove={() => {
            const next = props.pages.filter((candidate) => candidate !== page);
            // The list always shows something; dropping the last page falls back to the default.
            props.onPagesChange(next.length > 0 ? next : ["threads"]);
          }}
        />
      ))}
      {organisations.map((option) => (
        <SidebarFilterPill
          key={option.key}
          icon={<BuildingIcon aria-hidden className="size-3.5" />}
          label={option.label}
          onRemove={() =>
            props.onScopedOrganisationKeysChange(
              props.scopedOrganisationKeys.filter((key) => key !== option.key),
            )
          }
        />
      ))}
      {projects.map((project) => (
        <SidebarFilterPill
          key={project.projectKey}
          icon={<ProjectFavicon project={project} className="size-3.5" />}
          label={project.displayName}
          onRemove={() =>
            props.onScopedProjectKeysChange(
              props.scopedProjectKeys.filter((key) => key !== project.projectKey),
            )
          }
        />
      ))}
      {pillCount > 1 ? (
        <button
          type="button"
          className="cursor-pointer px-1.5 text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground"
          onClick={() => {
            props.onPagesChange(["threads"]);
            props.onScopedOrganisationKeysChange([]);
            props.onScopedProjectKeysChange([]);
          }}
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
