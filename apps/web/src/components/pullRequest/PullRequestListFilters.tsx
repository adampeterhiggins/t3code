import { Spinner } from "~/components/ui/spinner";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  EyeIcon,
  EyeOffIcon,
  FolderGit2Icon,
  LayersIcon,
  ListFilterIcon,
  PenLineIcon,
  SearchIcon,
  TagIcon,
  UserRoundIcon,
} from "lucide-react";
import { type ElementType, useState } from "react";

import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { FilterPill } from "../FilterPill";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Button } from "../ui/button";

import { HighlightedSearchText } from "../ui/highlighted-search-text";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroupLabel,
  MenuItem,
  MenuLoadingItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSearch,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
  normalizeMenuSearch,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  pullRequestLabelColor,
  type PullRequestAuthorFacet,
  type PullRequestLabelFacet,
  type PullRequestListFacets,
} from "./pullRequestList.logic";
import { MenuChoiceLabel } from "../MenuChoiceLabel";
import { PullRequestActorAvatar } from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly Icon: ElementType<{ className?: string }>;
  readonly project?: ProjectFaviconProject;
  readonly unavailable?: string | undefined;
}

export function PullRequestFilterOptionIcon<Value extends string>({
  option,
}: {
  option: PullRequestFilterOption<Value>;
}) {
  return option.project ? (
    <ProjectFavicon project={option.project} className="size-3.5" />
  ) : (
    <option.Icon aria-hidden className="size-3.5" />
  );
}

// The state filters wear the same glyphs the rows do, so the two read as one vocabulary.
export const PULL_REQUEST_INVOLVEMENT_OPTIONS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "reviewing", label: "Reviewing", Icon: EyeIcon },
  { value: "authored", label: "Authored", Icon: PenLineIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;

export const PULL_REQUEST_STATE_OPTIONS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "open", label: "Open", Icon: PullRequestGlyph.pullRequest },
  { value: "closed", label: "Closed", Icon: PullRequestGlyph.closed },
  { value: "merged", label: "Merged", Icon: PullRequestGlyph.merged },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;

export interface PullRequestExpectedHost {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
}

export function pullRequestHostLabel(
  entries: ReadonlyArray<{ readonly host: string; readonly kind: SourceControlProviderKind }>,
  entry: { readonly host: string; readonly kind: SourceControlProviderKind },
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1
    ? entry.host
    : getSourceControlPresentationForKind(entry.kind).providerName;
}

export function PullRequestSearchInput({
  value,
  busy,
  onChange,
}: {
  value: string;
  busy?: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
      <InputGroupAddon>
        {busy ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          onChange(event.currentTarget.value);
        }}
        placeholder="Search pull requests, or label:bug"
        aria-label="Search pull requests"
      />
    </InputGroup>
  );
}

const ALL_PROJECTS_VALUE = "all";
/** MenuRadioGroup wants a string, so "every host" wears the one value no host can be. */
const ALL_HOSTS_VALUE = "";
const ALL_SERVERS_VALUE = "";
const UNFILTERED_VALUE = "all";
/**
 * A project's own radio value, carrying the server along with the id: the id alone is only
 * unique within its own server, so two rows sharing one would otherwise both read as checked.
 */
export const pullRequestProjectKey = (project: {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
}) => JSON.stringify([project.environmentId, project.id]);

const DRAFT_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "only", label: "Drafts only", Icon: PullRequestGlyph.draft },
  { value: "hide", label: "Hide drafts", Icon: EyeOffIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const REVIEW_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "approved", label: "Approved", Icon: CircleCheckIcon },
  { value: "changes-requested", label: "Changes requested", Icon: CircleXIcon },
  { value: "review-required", label: "Review required", Icon: CircleDashedIcon },
  { value: "none", label: "No reviews", Icon: CircleSlashIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const CHECKS_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "passing", label: "Passing", Icon: CircleCheckIcon },
  { value: "failing", label: "Failing", Icon: CircleXIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

/** A choice's count, right-aligned beside it. */
function MenuChoiceCount({ count }: { count: number | undefined }) {
  return count === undefined ? null : (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
  );
}

function PullRequestFilterRadioGroup<Value extends string>({
  label,
  value,
  options,
  counts,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  counts: Readonly<Record<string, number>> | undefined;
  onChange: (value: Value) => void;
}) {
  return (
    <MenuRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value) onChange(next as Value);
      }}
    >
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {options.map((option) => {
        const item = (
          <MenuRadioItem
            key={option.value}
            value={option.value}
            className={option.unavailable ? "data-disabled:pointer-events-auto" : undefined}
            disabled={option.unavailable !== undefined}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestFilterOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailable ? <span className="shrink-0">· Unavailable</span> : null}
              <MenuChoiceCount count={counts && (counts[option.value] ?? 0)} />
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        );
        if (!option.unavailable) return item;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={item} />
            <TooltipPopup side="top">{option.unavailable}</TooltipPopup>
          </Tooltip>
        );
      })}
    </MenuRadioGroup>
  );
}

/**
 * A filter row showing its current value, opening a radio list of the options. `counts`, keyed
 * by option value, puts how many rows each choice would show beside it.
 */
export function PullRequestFilterRadioSubmenu<Value extends string>({
  label,
  value,
  options,
  counts,
  onChange,
  optionsPending = false,
}: {
  label: string;
  value: Value;
  optionsPending?: boolean;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  counts?: Readonly<Record<string, number>> | undefined;
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current && !optionsPending) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        {current ? <PullRequestFilterOptionIcon option={current} /> : null}
        <span className="flex-1">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current?.label ?? "Loading…"}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {optionsPending && options.length === 0 ? (
          <MenuLoadingItem>Loading filters…</MenuLoadingItem>
        ) : (
          <PullRequestFilterRadioGroup
            label={label}
            value={value}
            options={options}
            counts={counts}
            onChange={onChange}
          />
        )}
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestAuthorFilter({
  value,
  options,
  optionsPending,
  onChange,
}: {
  value: string | undefined;
  options: ReadonlyArray<PullRequestAuthorFacet>;
  optionsPending: boolean;
  onChange: (author: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = normalizeMenuSearch(query);
  const login = value?.toLowerCase() ?? "";
  const selected = options.find((option) => option.actor.login.toLowerCase() === login);
  const visible = [
    ...(selected ? [selected] : []),
    ...options.filter(
      (option) =>
        option !== selected &&
        (needle.length === 0 ||
          option.actor.login.toLowerCase().includes(needle) ||
          option.actor.name?.toLowerCase().includes(needle)),
    ),
  ].slice(0, 10);
  const select = (next: string) => next.toLowerCase() !== login && onChange(next || undefined);
  return (
    <MenuSub>
      <MenuSubTrigger>
        <UserRoundIcon aria-hidden className="size-3.5" />
        <span className="flex-1">Author</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {value ?? "Anyone"}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <MenuSearchInput value={query} placeholder="Search authors" onChange={setQuery} />
        <MenuRadioGroup value={selected?.actor.login ?? value ?? ""} onValueChange={select}>
          <MenuRadioItem value="">
            <span className="flex min-w-0 items-center gap-2">
              <LayersIcon aria-hidden className="size-3.5" />
              Anyone
            </span>
          </MenuRadioItem>
          {visible.map((option) => (
            <MenuRadioItem key={option.actor.login.toLowerCase()} value={option.actor.login}>
              <span className="flex min-w-0 items-center gap-2">
                <PullRequestActorAvatar actor={option.actor} />
                <span className="min-w-0 flex-1 truncate">
                  <HighlightedSearchText text={option.actor.login} query={query} />
                </span>
                <MenuChoiceCount count={option.count} />
              </span>
            </MenuRadioItem>
          ))}
          {visible.length === 0 ? (
            optionsPending ? (
              <MenuLoadingItem>Loading authors…</MenuLoadingItem>
            ) : (
              <MenuItem disabled>No authors found</MenuItem>
            )
          ) : null}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestLabelFilter({
  value,
  options,
  optionsPending,
  onChange,
  onOnly,
}: {
  value: ReadonlyArray<string>;
  /** Already holds every picked label, at 0 where the other filters leave none. */
  options: ReadonlyArray<PullRequestLabelFacet>;
  optionsPending: boolean;
  onChange: (labels: ReadonlyArray<string>) => void;
  /** "Only" settles the filter, so it also closes the menu. */
  onOnly: (label: string) => void;
}) {
  const selected = new Set(value.map((name) => name.toLowerCase()));
  const visible = options;
  return (
    <MenuSub>
      <MenuSubTrigger>
        <TagIcon aria-hidden className="size-3.5" />
        <span className="flex-1">Labels</span>
        <span className="text-xs text-muted-foreground">
          {value.length === 0 ? "Any" : `${value.length} selected`}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {visible.length === 0 ? (
          optionsPending ? (
            <MenuLoadingItem>Loading labels…</MenuLoadingItem>
          ) : (
            <MenuItem disabled>No labels in this view</MenuItem>
          )
        ) : (
          <MenuSearch items={visible} getText={(option) => option.name} placeholder="Search labels">
            {(matches, query) =>
              matches.map((option) => {
                const key = option.name.toLowerCase();
                const checked = selected.has(key);
                const dot = pullRequestLabelColor(option.color);
                return (
                  <MenuCheckboxItem
                    key={key}
                    checked={checked}
                    onCheckedChange={(next) =>
                      onChange(
                        next
                          ? [...value, option.name]
                          : value.filter(
                              (name) => name.toLowerCase() !== option.name.toLowerCase(),
                            ),
                      )
                    }
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
                        {...(dot ? { style: { backgroundColor: dot } } : {})}
                      />
                      <MenuChoiceLabel
                        label={option.name}
                        query={query}
                        onOnly={() => onOnly(option.name)}
                      />
                      <MenuChoiceCount count={option.count} />
                    </span>
                  </MenuCheckboxItem>
                );
              })
            }
          </MenuSearch>
        )}
      </MenuSubPopup>
    </MenuSub>
  );
}

export function PullRequestFiltersMenu({
  size = "default",
  open,
  onOpenChange,
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
  optionsPending = false,
  facets,
  host,
  hostOptions,
  onHost,
  server,
  serverOptions,
  onServer,
  projects,
  projectId,
  projectEnvironmentId,
  unavailable,
  onProject,
}: {
  /** `xs` for a picker's filter row, beside its other small controls. */
  size?: "default" | "xs";
  /** Controlled by the caller so "Only" can close it; left out, the menu keeps its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  state: PullRequestListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;
  onState: (state: PullRequestListState) => void;
  involvement: PullRequestInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  filters: PullRequestListFilters;
  onFilters: (filters: PullRequestListFilters) => void;
  /** Authors and labels come from asynchronous listings; fixed choices stay available. */
  optionsPending?: boolean;
  /**
   * The choices and counts drawn from the loaded rows (`collectPullRequestListFacets`). Absent
   * until there is anything to count, which leaves the fixed choices uncounted.
   */
  facets?: PullRequestListFacets | undefined;
  host: string | undefined;
  hostOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  serverOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onServer: (server: EnvironmentId | undefined) => void;
  /**
   * The projects of every connected environment, each carrying the one its favicon is read from.
   * Empty leaves the Project group out, for a list already scoped to one project.
   */
  projects: ReadonlyArray<ProjectFaviconProject & { readonly id: ProjectId }>;
  projectId: ProjectId | undefined;
  projectEnvironmentId: EnvironmentId | undefined;
  unavailable: ReadonlyMap<string, string>;
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  const selectedLabels = (filters.labels ?? []).flatMap((group) => group);
  const filterCount = [
    state !== "open",
    involvement !== "all",
    host,
    server,
    projectId,
    filters.draft,
    filters.review,
    filters.checks,
    filters.author,
    ...selectedLabels,
  ].filter(Boolean).length;
  const updateFilters = (next: Partial<PullRequestListFilters>) =>
    onFilters(
      Object.fromEntries(
        Object.entries({ ...filters, ...next }).filter(([, value]) => value !== undefined),
      ) as PullRequestListFilters,
    );
  const updateFilter = (key: keyof PullRequestListFilters, value: string) =>
    updateFilters({
      [key]: value === UNFILTERED_VALUE ? undefined : value,
    } as Partial<PullRequestListFilters>);
  const projectValue =
    projectId === undefined || projectEnvironmentId === undefined
      ? ALL_PROJECTS_VALUE
      : pullRequestProjectKey({ id: projectId, environmentId: projectEnvironmentId });
  const projectOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: ALL_PROJECTS_VALUE, label: "All projects", Icon: LayersIcon },
    ...projects
      .toSorted(
        (left, right) =>
          Number(unavailable.has(pullRequestProjectKey(left))) -
          Number(unavailable.has(pullRequestProjectKey(right))),
      )
      .map((project) => ({
        value: pullRequestProjectKey(project),
        label: project.title,
        Icon: FolderGit2Icon,
        project,
        ...(unavailable.has(pullRequestProjectKey(project))
          ? { unavailable: unavailable.get(pullRequestProjectKey(project)) }
          : {}),
      })),
  ];
  const changeOpen = (next: boolean) => onOpenChange?.(next);
  // Nothing counted yet reads as "still loading", not as a menu of zeroes.
  const counts = facets && !(optionsPending && facets.loaded === 0) ? facets : undefined;
  return (
    <Menu {...(open === undefined ? {} : { open })} onOpenChange={changeOpen}>
      <MenuTrigger render={<Button variant="outline" size={size} />}>
        <ListFilterIcon className={size === "xs" ? undefined : "size-4"} />
        <span>Filters</span>
        {filterCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {filterCount}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <PullRequestFilterRadioSubmenu
          label="State"
          value={state}
          options={stateOptions}
          counts={counts?.state}
          onChange={onState}
        />
        <PullRequestFilterRadioSubmenu
          label="Involvement"
          value={involvement}
          options={involvementOptions}
          counts={counts?.involvement}
          onChange={onInvolvement}
        />
        <MenuSeparator />
        <PullRequestAuthorFilter
          value={filters.author}
          options={facets?.authors ?? []}
          optionsPending={optionsPending}
          onChange={(author) => updateFilters({ author })}
        />
        <PullRequestLabelFilter
          value={selectedLabels}
          options={facets?.labels ?? []}
          optionsPending={optionsPending}
          onChange={(labels) =>
            updateFilters({
              labels: labels.length === 0 ? undefined : labels.slice(0, 10).map((label) => [label]),
            })
          }
          onOnly={(label) => {
            updateFilters({ labels: [[label]] });
            changeOpen(false);
          }}
        />
        <PullRequestFilterRadioSubmenu
          label="Draft"
          value={filters.draft ?? UNFILTERED_VALUE}
          options={DRAFT_OPTIONS}
          counts={counts?.draft}
          onChange={(draft) => updateFilter("draft", draft)}
        />
        <PullRequestFilterRadioSubmenu
          label="Review"
          value={filters.review ?? UNFILTERED_VALUE}
          options={REVIEW_OPTIONS}
          counts={counts?.review}
          onChange={(review) => updateFilter("review", review)}
        />
        <PullRequestFilterRadioSubmenu
          label="Checks"
          value={filters.checks ?? UNFILTERED_VALUE}
          options={CHECKS_OPTIONS}
          onChange={(checks) => updateFilter("checks", checks)}
        />
        {hostOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label="Host"
              value={host ?? ALL_HOSTS_VALUE}
              options={hostOptions}
              onChange={(next) => onHost(next === ALL_HOSTS_VALUE ? undefined : next)}
            />
          </>
        ) : null}
        {serverOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label="Server"
              value={server ?? ALL_SERVERS_VALUE}
              options={serverOptions}
              onChange={(next) =>
                onServer(next === ALL_SERVERS_VALUE ? undefined : (next as EnvironmentId))
              }
            />
          </>
        ) : null}
        {projects.length > 0 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label="Project"
              value={projectValue}
              options={projectOptions}
              onChange={(next) => {
                const project = projects.find(
                  (candidate) => pullRequestProjectKey(candidate) === next,
                );
                if (project) onProject(project.id, project.environmentId);
                else if (projectId !== undefined) onProject(undefined, undefined);
              }}
            />
          </>
        ) : null}
        {counts ? (
          <>
            <MenuSeparator />
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Counts cover the {counts.loaded} loaded pull{" "}
              {counts.loaded === 1 ? "request" : "requests"}
            </p>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

type PullRequestFiltersProps = Parameters<typeof PullRequestFiltersMenu>[0];

/**
 * The filters the menu has applied, one pill each on a row of their own below the controls,
 * every one removable with its ×. Takes the menu's own props, so the two always agree.
 */
export function PullRequestAppliedFilters(props: PullRequestFiltersProps) {
  const { filters } = props;
  const updateFilters = (next: Partial<PullRequestListFilters>) =>
    props.onFilters(
      Object.fromEntries(
        Object.entries({ ...filters, ...next }).filter(([, value]) => value !== undefined),
      ) as PullRequestListFilters,
    );
  const pill = <Value extends string>(
    key: string,
    option: PullRequestFilterOption<Value> | undefined,
    label: string | undefined,
    onRemove: () => void,
  ) =>
    option === undefined ? null : (
      <FilterPill
        key={key}
        icon={<PullRequestFilterOptionIcon option={option} />}
        label={label ?? option.label}
        onRemove={onRemove}
      />
    );
  const optionOf = <Value extends string>(
    options: ReadonlyArray<PullRequestFilterOption<Value>>,
    value: string | undefined,
  ) => (value === undefined ? undefined : options.find((option) => option.value === value));
  const labels = (filters.labels ?? []).flat();
  const project = props.projects.find(
    (candidate) =>
      candidate.id === props.projectId && candidate.environmentId === props.projectEnvironmentId,
  );
  const pills = [
    props.state === "open"
      ? null
      : pill(
          "state",
          optionOf(props.stateOptions, props.state),
          props.state === "all" ? "All states" : undefined,
          () => props.onState("open"),
        ),
    props.involvement === "all"
      ? null
      : pill("involvement", optionOf(props.involvementOptions, props.involvement), undefined, () =>
          props.onInvolvement("all"),
        ),
    filters.author === undefined ? null : (
      <FilterPill
        key="author"
        icon={<UserRoundIcon />}
        label={`by ${filters.author}`}
        onRemove={() => updateFilters({ author: undefined })}
      />
    ),
    ...labels.map((label) => (
      <FilterPill
        key={`label:${label}`}
        icon={<TagIcon />}
        label={label}
        onRemove={() => {
          const rest = labels.filter((name) => name !== label);
          updateFilters({ labels: rest.length === 0 ? undefined : rest.map((name) => [name]) });
        }}
      />
    )),
    pill("draft", optionOf(DRAFT_OPTIONS, filters.draft), undefined, () =>
      updateFilters({ draft: undefined }),
    ),
    pill("review", optionOf(REVIEW_OPTIONS, filters.review), undefined, () =>
      updateFilters({ review: undefined }),
    ),
    pill(
      "checks",
      optionOf(CHECKS_OPTIONS, filters.checks),
      filters.checks === undefined ? undefined : `Checks ${filters.checks}`,
      () => updateFilters({ checks: undefined }),
    ),
    pill("host", optionOf(props.hostOptions, props.host), undefined, () => props.onHost(undefined)),
    pill("server", optionOf(props.serverOptions, props.server), undefined, () =>
      props.onServer(undefined),
    ),
    project === undefined ? null : (
      <FilterPill
        key="project"
        icon={<ProjectFavicon project={project} className="size-3.5" />}
        label={project.title}
        onRemove={() => props.onProject(undefined, undefined)}
      />
    ),
  ].filter((entry) => entry !== null);
  if (pills.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1">{pills}</div>;
}
