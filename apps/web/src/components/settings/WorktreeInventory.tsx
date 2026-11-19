import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import {
  WS_METHODS,
  type EnvironmentId,
  type ManagedWorktree,
  type WorktreeInventoryRemoveResult,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowDownUpIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  ClockIcon,
  GitBranchIcon,
  HistoryIcon,
  Maximize2Icon,
  Minimize2Icon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  EyeOffIcon,
  FolderIcon,
  GaugeIcon,
  LayersIcon,
  ListFilterIcon,
  LoaderIcon,
  PenLineIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { type ReactNode, useEffect, useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { requestConfirmDialog } from "../../confirmDialog";
import { useClientSettings } from "../../hooks/useSettings";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { FilterPill } from "../FilterPill";
import {
  PullRequestFilterOptionIcon,
  PullRequestFilterRadioSubmenu,
  type PullRequestFilterOption,
} from "../pullRequest/PullRequestListFilters";
import { PullRequestCompactFilterMenu } from "../pullRequest/PullRequestCompactFilterMenu";
import { PULL_REQUEST_STATE_PRESENTATION, PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { resolveFilterOptions } from "../pullRequest/pullRequestListOptions";
import { m, type MessageResolver } from "../../i18n/messages";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  ALL_WORKTREE_FILTERS,
  countWorktreeFacet,
  DEFAULT_WORKTREE_DATE_FORMATS,
  defaultSortDirection,
  filterWorktrees,
  formatWorktreeDate,
  sortWorktrees,
  worktreeCheckout,
  WorktreeDateFormats,
  worktreeRemovable,
  type WorktreeCheckout,
  type WorktreeDateFormat,
  type WorktreeFilters,
  type WorktreeSort,
  type WorktreeSortColumn,
} from "./worktreeInventory.logic";

const listWorktrees = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:list-worktrees",
  tag: WS_METHODS.worktreesList,
});
const sizeWorktree = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:size-worktree",
  tag: WS_METHODS.worktreesSize,
});
const removeWorktrees = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:remove-worktrees",
  tag: WS_METHODS.worktreesRemove,
});

/** The remove RPC takes at most this many paths per request. */
const REMOVE_BATCH = 200;
/** The server measures two at a time; a little more keeps its queue fed. */
const MEASURE_CONCURRENCY = 4;
const DATE_FORMATS_STORAGE_KEY = "t3.settings.worktreeInventory.dateFormats";

const STATE_OPTIONS = [
  { value: "all", label: msg("All", { $context: "worktree filter" }), Icon: LayersIcon },
  {
    value: "active",
    label: msg("Active", { $context: "worktree thread state" }),
    Icon: CircleDotIcon,
  },
  {
    value: "settled",
    label: msg("Settled", { $context: "worktree thread state" }),
    Icon: CircleCheckIcon,
  },
  {
    value: "archived",
    label: msg("Archived", { $context: "worktree thread state" }),
    Icon: ArchiveIcon,
  },
  { value: "none", label: msg("No thread"), Icon: CircleDashedIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<WorktreeFilters["state"]>>;

const CHECKOUT_OPTIONS = [
  { value: "all", label: msg("All", { $context: "worktree filter" }), Icon: LayersIcon },
  {
    value: "clean",
    label: msg("Clean", { $context: "git checkout with no local changes" }),
    Icon: CircleCheckIcon,
  },
  { value: "dirty", label: msg("Local changes"), Icon: PenLineIcon },
  {
    value: "running",
    label: msg("Running", { $context: "worktree has running work" }),
    Icon: LoaderIcon,
  },
  { value: "unknown", label: msg("Unreadable"), Icon: EyeOffIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<WorktreeFilters["checkout"]>>;

const PULL_REQUEST_OPTIONS = [
  { value: "all", label: msg("All", { $context: "worktree filter" }), Icon: LayersIcon },
  {
    value: "open",
    label: msg("Open", { $context: "pull request state" }),
    Icon: PullRequestGlyph.pullRequest,
  },
  {
    value: "merged",
    label: msg("Merged", { $context: "pull request state" }),
    Icon: PullRequestGlyph.merged,
  },
  {
    value: "closed",
    label: msg("Closed", { $context: "pull request state" }),
    Icon: PullRequestGlyph.closed,
  },
  { value: "unsynced", label: msg("Not synced"), Icon: PullRequestGlyph.pullRequest },
  { value: "none", label: msg("No pull request"), Icon: CircleDashedIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<WorktreeFilters["pullRequest"]>>;

const STATE_DOT: Record<ManagedWorktree["state"], string> = {
  active: "bg-info",
  settled: "bg-success",
  archived: "bg-muted-foreground/60",
  none: "border border-muted-foreground/60",
};

const DATE_FORMAT_LABELS: Record<WorktreeDateFormat, string> = {
  relative: msg("Relative", { $context: "date format, such as 5m ago" }),
  date: msg("Date", { $context: "date format" }),
  datetime: msg("Date and time"),
};
const DATE_COLUMN_WIDTH: Record<WorktreeDateFormat, string> = {
  relative: "w-18",
  date: "w-28",
  datetime: "w-40",
};

function CheckoutCell({ checkout }: { checkout: WorktreeCheckout }) {
  switch (checkout) {
    case "clean":
      return (
        <span className="text-muted-foreground">
          <T context="git checkout with no local changes">Clean</T>
        </span>
      );
    case "dirty":
      return (
        <Badge size="sm" variant="warning">
          <T>Local changes</T>
        </Badge>
      );
    case "running":
      return (
        <Badge size="sm" variant="info">
          <T context="worktree has running work">Running</T>
        </Badge>
      );
    case "unknown":
      return (
        <Badge size="sm" variant="outline">
          <T>Unreadable</T>
        </Badge>
      );
  }
}

function PullRequestCell({ pullRequest }: { pullRequest: ManagedWorktree["pullRequest"] }) {
  const gt = useGT();
  const messages = useMessages();
  if (pullRequest === null) return <span className="text-muted-foreground/60">—</span>;
  const presentation = pullRequest.state
    ? PULL_REQUEST_STATE_PRESENTATION[pullRequest.state]
    : null;
  const Icon = presentation?.Icon ?? PullRequestGlyph.pullRequest;
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noreferrer"
      aria-label={gt("Pull request {number}, {state}", {
        number: pullRequest.number,
        state: presentation ? messages(presentation.label).toLowerCase() : gt("state not synced"),
      })}
      className="inline-flex items-center gap-1 tabular-nums hover:underline"
    >
      <Icon
        aria-hidden
        className={cn("size-3.5", presentation?.toneClassName ?? "text-muted-foreground")}
      />
      #{pullRequest.number}
    </a>
  );
}

function SortableHead({
  column,
  sort,
  onSort,
  align = "start",
  action,
  children,
}: {
  column: WorktreeSortColumn;
  sort: WorktreeSort;
  onSort: (column: WorktreeSortColumn) => void;
  align?: "start" | "end";
  /** A control beside the label, such as the column's format menu. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const active = sort.column === column;
  const Arrow = sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn(align === "end" && "text-right")}
    >
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onSort(column)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 font-medium",
            align === "end" && "flex-row-reverse",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {children}
          {active ? <Arrow aria-hidden className="size-3" /> : null}
        </button>
        {action}
      </span>
    </TableHead>
  );
}

function DateFormatMenu({
  column,
  value,
  onChange,
}: {
  column: "created" | "updated";
  value: WorktreeDateFormat;
  onChange: (format: WorktreeDateFormat) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  return (
    <Menu>
      <MenuTrigger
        aria-label={column === "created" ? gt("Created format") : gt("Updated format")}
        render={<Button size="icon-micro" variant="ghost-muted" />}
      >
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <MenuGroupLabel>
          {column === "created" ? <T>Show created as</T> : <T>Show updated as</T>}
        </MenuGroupLabel>
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as WorktreeDateFormat)}
        >
          {(Object.keys(DATE_FORMAT_LABELS) as WorktreeDateFormat[]).map((format) => (
            <MenuRadioItem key={format} value={format}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex-1">{messages(DATE_FORMAT_LABELS[format])}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function WorktreeFiltersMenu({
  worktrees,
  filters,
  onFilters,
}: {
  worktrees: ReadonlyArray<ManagedWorktree>;
  filters: WorktreeFilters;
  onFilters: (filters: WorktreeFilters) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const projectOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "all", label: gt("All projects"), Icon: LayersIcon },
    ...[...new Set(worktrees.map((entry) => entry.repositoryName))]
      .toSorted((left, right) => left.localeCompare(right))
      .map((name) => ({ value: name, label: name, Icon: FolderIcon })),
  ];
  const activeCount = Object.values(filters).filter((value) => value !== "all").length;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>
        <ListFilterIcon className="size-4" />
        <span>
          <T>Filters</T>
        </span>
        {activeCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {activeCount}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <PullRequestFilterRadioSubmenu
          label={gt("State", { $context: "worktree thread state" })}
          value={filters.state}
          options={resolveFilterOptions(STATE_OPTIONS, messages)}
          counts={countWorktreeFacet(worktrees, "state")}
          onChange={(state) => onFilters({ ...filters, state })}
        />
        <PullRequestFilterRadioSubmenu
          label={gt("Checkout", { $context: "noun, a git working copy" })}
          value={filters.checkout}
          options={resolveFilterOptions(CHECKOUT_OPTIONS, messages)}
          counts={countWorktreeFacet(worktrees, "checkout")}
          onChange={(checkout) => onFilters({ ...filters, checkout })}
        />
        <PullRequestFilterRadioSubmenu
          label={gt("Pull request")}
          value={filters.pullRequest}
          options={resolveFilterOptions(PULL_REQUEST_OPTIONS, messages)}
          counts={countWorktreeFacet(worktrees, "pullRequest")}
          onChange={(pullRequest) => onFilters({ ...filters, pullRequest })}
        />
        <MenuSeparator />
        <PullRequestFilterRadioSubmenu
          label={gt("Project")}
          value={filters.project}
          options={projectOptions}
          counts={countWorktreeFacet(worktrees, "project")}
          onChange={(project) => onFilters({ ...filters, project })}
        />
      </MenuPopup>
    </Menu>
  );
}

function AppliedWorktreeFilters({
  filters,
  onFilters,
}: {
  filters: WorktreeFilters;
  onFilters: (filters: WorktreeFilters) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const pill = <Key extends keyof WorktreeFilters>(
    key: Key,
    options: ReadonlyArray<PullRequestFilterOption<string>>,
    prefix?: string,
  ) => {
    const value = filters[key];
    if (value === "all") return null;
    const option = options.find((candidate) => candidate.value === value) ?? {
      value,
      label: value,
      Icon: FolderIcon,
    };
    return (
      <FilterPill
        key={key}
        icon={<PullRequestFilterOptionIcon option={option} />}
        label={
          prefix ? gt("{label}: {value}", { label: prefix, value: option.label }) : option.label
        }
        onRemove={() => onFilters({ ...filters, [key]: "all" })}
      />
    );
  };
  const pills = [
    pill("state", resolveFilterOptions(STATE_OPTIONS, messages)),
    pill(
      "checkout",
      resolveFilterOptions(CHECKOUT_OPTIONS, messages),
      gt("Checkout", { $context: "noun, a git working copy" }),
    ),
    pill("pullRequest", resolveFilterOptions(PULL_REQUEST_OPTIONS, messages), gt("Pull request")),
    pill("project", []),
  ].filter((entry) => entry !== null);
  if (pills.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1">{pills}</div>;
}

const SORT_OPTIONS = [
  { value: "updated:desc", label: msg("Recently updated"), Icon: ClockIcon },
  { value: "updated:asc", label: msg("Least recently updated"), Icon: HistoryIcon },
  {
    value: "created:desc",
    label: msg("Newest", { $context: "sort order" }),
    Icon: CalendarArrowDownIcon,
  },
  {
    value: "created:asc",
    label: msg("Oldest", { $context: "sort order" }),
    Icon: CalendarArrowUpIcon,
  },
  { value: "size:desc", label: msg("Largest", { $context: "sort order" }), Icon: Maximize2Icon },
  { value: "size:asc", label: msg("Smallest", { $context: "sort order" }), Icon: Minimize2Icon },
  {
    value: "project:asc",
    label: msg("Project", { $context: "sort by project" }),
    Icon: FolderIcon,
  },
  {
    value: "worktree:asc",
    label: msg("Branch", { $context: "sort by branch" }),
    Icon: GitBranchIcon,
  },
  {
    value: "state:desc",
    label: msg("State", { $context: "sort by worktree thread state" }),
    Icon: CircleDotIcon,
  },
  {
    value: "checkout:desc",
    label: msg("Checkout", { $context: "sort by git checkout status" }),
    Icon: CircleCheckIcon,
  },
] as const satisfies ReadonlyArray<
  PullRequestFilterOption<`${WorktreeSortColumn}:${WorktreeSort["direction"]}`>
>;

function StateLabel({ state }: { state: ManagedWorktree["state"] }) {
  const messages = useMessages();
  const label = STATE_OPTIONS.find((option) => option.value === state)?.label;
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} />
      {label === undefined ? null : messages(label)}
    </span>
  );
}

function ThreadSummary({
  environmentId,
  threads,
}: {
  environmentId: EnvironmentId;
  threads: ManagedWorktree["threads"];
}) {
  const [first, ...others] = threads;
  if (!first) {
    return (
      <div className="truncate text-muted-foreground/70">
        <T>No thread</T>
      </div>
    );
  }
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId, threadId: first.threadId }}
      className="block truncate text-muted-foreground hover:text-foreground hover:underline"
    >
      {first.title}
      {others.length > 0 ? (
        <span className="text-muted-foreground/70"> +{others.length}</span>
      ) : null}
    </Link>
  );
}

function SizeControl({
  bytes,
  measuring,
  onMeasure,
}: {
  bytes: number | null | undefined;
  measuring: boolean;
  onMeasure: () => void;
}) {
  const gt = useGT();
  if (measuring) {
    return (
      <span className="text-muted-foreground">
        <T>Measuring…</T>
      </span>
    );
  }
  if (typeof bytes === "number") return <span className="tabular-nums">{formatBytes(bytes)}</span>;
  return (
    <Button
      size="micro"
      variant="ghost-muted"
      aria-label={bytes === null ? gt("Size unavailable. Measure again") : undefined}
      onClick={onMeasure}
    >
      {bytes === null ? <T>Retry</T> : <T context="verb, measures disk usage">Measure</T>}
    </Button>
  );
}

function removalNotice(
  results: WorktreeInventoryRemoveResult["results"],
  resolve: MessageResolver = m,
): string {
  const removed = results.filter((entry) => entry.outcome === "removed").length;
  const refused = results.filter((entry) => entry.outcome !== "removed");
  const reasons = [...new Set(refused.map((entry) => entry.outcome.replaceAll("_", " ")))];
  const removedText = resolve(
    msg("{count, plural, one {Removed {count} worktree.} other {Removed {count} worktrees.}}", {
      count: removed,
    }),
  );
  if (refused.length === 0) return removedText;
  const keptText = resolve(
    msg("Kept {count}: {reasons}.", { count: refused.length, reasons: reasons.join(", ") }),
  );
  return `${removedText} ${keptText}`;
}

function WorktreesOnEnvironment({
  environmentId,
  name,
}: {
  environmentId: EnvironmentId;
  name: string;
}) {
  const list = useAtomCommand(listWorktrees);
  const size = useAtomCommand(sizeWorktree);
  const remove = useAtomCommand(removeWorktrees);
  const canRemove = useAtomValue(removeWorktrees.permissionAtom(environmentId));
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  // Phones get cards: the table needs more width than they have.
  const narrow = useIsMobile();
  const [dateFormats, setDateFormats] = useLocalStorage(
    DATE_FORMATS_STORAGE_KEY,
    DEFAULT_WORKTREE_DATE_FORMATS,
    WorktreeDateFormats,
  );
  const [worktrees, setWorktrees] = useState<readonly ManagedWorktree[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [measuring, setMeasuring] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<WorktreeFilters>(ALL_WORKTREE_FILTERS);
  const [sort, setSort] = useState<WorktreeSort>({ column: "updated", direction: "desc" });
  // Relative dates count from when the list was read, so they agree with the rows beside them.
  const [loadedAtMs, setLoadedAtMs] = useState(0);
  const gt = useGT();
  const messages = useMessages();

  const refresh = async () => {
    setBusy(true);
    const result = await list({ environmentId, input: {} });
    setBusy(false);
    if (result._tag === "Success") {
      setWorktrees(result.value.worktrees);
      setLoadedAtMs(Date.now());
      setSelected(new Set());
    } else setNotice(m(msg("Could not load worktrees. Refresh to try again.")));
  };
  useEffect(() => {
    let cancelled = false;
    void list({ environmentId, input: {} }).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (result._tag === "Success") {
        setWorktrees(result.value.worktrees);
        setLoadedAtMs(Date.now());
      } else setNotice(m(msg("Could not load worktrees. Refresh to try again.")));
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, list]);

  const visible = sortWorktrees(filterWorktrees(worktrees, filters, query), sort, sizes);
  const removable = visible.filter(worktreeRemovable);
  // Rows hidden by a filter stay unselected for removal, so nothing off-screen is deleted.
  const selectedVisible = removable.filter((entry) => selected.has(entry.path));
  const allSelected = removable.length > 0 && selectedVisible.length === removable.length;
  const measured = worktrees.filter((entry) => typeof sizes[entry.path] === "number");
  const measuredBytes = measured.reduce((total, entry) => total + (sizes[entry.path] ?? 0), 0);
  const selectedBytes = selectedVisible.reduce(
    (total, entry) => total + (sizes[entry.path] ?? 0),
    0,
  );
  const unmeasured = visible.filter(
    (entry) => sizes[entry.path] === undefined && !measuring.has(entry.path),
  );

  const measure = async (paths: readonly string[]) => {
    setMeasuring((current) => new Set([...current, ...paths]));
    const queue = [...paths];
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const result = await size({ environmentId, input: { path } });
        const bytes = result._tag === "Success" ? result.value.bytes : null;
        setSizes((current) => ({ ...current, [path]: bytes }));
        setMeasuring((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(MEASURE_CONCURRENCY, paths.length) }, worker));
  };

  const prune = async (paths: readonly string[]) => {
    const message = m(
      msg(
        "Remove {count, plural, one {{count} worktree} other {{count} worktrees}} from {name}? Branches and thread history are kept. Clean checkouts can be recreated when threads resume. Running work and local changes are always protected.",
        { count: paths.length, name },
      ),
    );
    const confirmed = await (requestConfirmDialog(message, { variant: "destructive" }) ??
      Promise.resolve(window.confirm(message)));
    if (!confirmed) return;
    setBusy(true);
    const results: Array<WorktreeInventoryRemoveResult["results"][number]> = [];
    for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
      const result = await remove({
        environmentId,
        input: { paths: paths.slice(start, start + REMOVE_BATCH) },
      });
      if (result._tag !== "Success") {
        setNotice(
          results.length > 0
            ? `${removalNotice(results)} ${m(msg("Could not remove the rest."))}`
            : m(msg("Could not remove worktrees.")),
        );
        await refresh();
        return;
      }
      results.push(...result.value.results);
    }
    setNotice(removalNotice(results));
    await refresh();
  };

  const toggleSort = (column: WorktreeSortColumn) =>
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: defaultSortDirection(column) },
    );
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(removable.map((entry) => entry.path)));
  const toggleOne = (path: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  const setDateFormat = (column: "created" | "updated") => (format: WorktreeDateFormat) =>
    setDateFormats((current) => ({ ...current, [column]: format }));

  return (
    <div className="space-y-3 py-3">
      <div className="space-y-3 px-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-medium">{name}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {measured.length === 0
              ? gt("{count, plural, one {{count} worktree} other {{count} worktrees}}", {
                  count: worktrees.length,
                })
              : measured.length < worktrees.length
                ? gt(
                    "{count, plural, one {{count} worktree} other {{count} worktrees}} · {size} across {measured} measured",
                    {
                      count: worktrees.length,
                      size: formatBytes(measuredBytes),
                      measured: measured.length,
                    },
                  )
                : gt("{count, plural, one {{count} worktree} other {{count} worktrees}} · {size}", {
                    count: worktrees.length,
                    size: formatBytes(measuredBytes),
                  })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-0 flex-1 basis-48 **:[input]:h-9 sm:**:[input]:h-8">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={gt("Search branches, paths, threads")}
              aria-label={gt("Search worktrees")}
            />
          </InputGroup>
          {narrow ? (
            <PullRequestCompactFilterMenu
              label={gt("Sort worktrees")}
              triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
              triggerLabel={gt("Sort", { $context: "verb, sort a list" })}
              outlined
              value={`${sort.column}:${sort.direction}`}
              options={resolveFilterOptions(SORT_OPTIONS, messages)}
              onChange={(next) => {
                const [column, direction] = next.split(":") as [
                  WorktreeSortColumn,
                  WorktreeSort["direction"],
                ];
                setSort({ column, direction });
              }}
            />
          ) : null}
          <WorktreeFiltersMenu worktrees={worktrees} filters={filters} onFilters={setFilters} />
          <Button
            variant="outline"
            disabled={busy || unmeasured.length === 0}
            onClick={() => void measure(unmeasured.map((entry) => entry.path))}
          >
            <GaugeIcon className="size-4" />
            {measuring.size > 0 ? (
              <T>
                Measuring <Var>{measuring.size}</Var>…
              </T>
            ) : (
              <T>Measure all</T>
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={gt("Refresh worktrees")}
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshIcon />
          </Button>
        </div>
        <AppliedWorktreeFilters filters={filters} onFilters={setFilters} />
        {notice && (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {selectedVisible.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-xs">
            <span className="mr-auto font-medium">
              {selectedBytes > 0
                ? gt("{count} selected · frees {size}", {
                    count: selectedVisible.length,
                    size: formatBytes(selectedBytes),
                  })
                : gt("{count} selected", { count: selectedVisible.length })}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
              <T context="verb, clears the selection">Clear</T>
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={busy || !canRemove}
              onClick={() => void prune(selectedVisible.map((entry) => entry.path))}
            >
              <Trash2Icon />
              <T>
                Remove <Var>{selectedVisible.length}</Var>
              </T>
            </Button>
          </div>
        )}
      </div>
      {busy && worktrees.length === 0 ? (
        <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
          <T>Loading…</T>
        </p>
      ) : worktrees.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          <T>No managed worktrees.</T>
        </p>
      ) : narrow ? (
        <div className="border-t border-border/50">
          <label className="flex items-center gap-2.5 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedVisible.length > 0 && !allSelected}
              disabled={busy || !canRemove || removable.length === 0}
              onCheckedChange={toggleAll}
            />
            <T>Select all removable</T>
          </label>
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              <T>No worktrees match these filters.</T>
            </p>
          ) : (
            visible.map((entry) => {
              const safe = worktreeRemovable(entry);
              return (
                <div
                  key={entry.path}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 border-b border-border/50 px-3 py-2.5 text-xs last:border-0"
                >
                  <Checkbox
                    className="mt-0.5"
                    aria-label={gt("Select {name}", { name: entry.branch ?? entry.path })}
                    checked={safe && selected.has(entry.path)}
                    disabled={busy || !canRemove || !safe}
                    onCheckedChange={(checked) => toggleOne(entry.path, checked)}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {entry.branch ?? (
                        <span className="text-muted-foreground">
                          <T>Detached HEAD</T>
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 gap-1 text-muted-foreground">
                      <span className="shrink-0">{entry.repositoryName} ·</span>
                      <ThreadSummary environmentId={environmentId} threads={entry.threads} />
                    </div>
                  </div>
                  <SizeControl
                    bytes={sizes[entry.path]}
                    measuring={measuring.has(entry.path)}
                    onMeasure={() => void measure([entry.path])}
                  />
                  <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StateLabel state={entry.state} />
                    {safe ? null : <CheckoutCell checkout={worktreeCheckout(entry)} />}
                    {entry.pullRequest ? <PullRequestCell pullRequest={entry.pullRequest} /> : null}
                    <span className="ml-auto text-muted-foreground tabular-nums">
                      <T>
                        updated{" "}
                        <Var>
                          {formatWorktreeDate(
                            entry.updatedAt,
                            dateFormats.updated,
                            timestampFormat,
                            loadedAtMs,
                          )}
                        </Var>
                      </T>
                    </span>
                    {safe && canRemove ? (
                      <Button
                        size="icon-xs"
                        variant="ghost-destructive"
                        aria-label={gt("Remove {name}", { name: entry.branch ?? entry.path })}
                        disabled={busy}
                        onClick={() => void prune([entry.path])}
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <Table className="min-w-[48rem] table-fixed">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-[14%]" />
            <col className="w-18" />
            <col className="w-22" />
            <col className="w-28" />
            <col className={DATE_COLUMN_WIDTH[dateFormats.created]} />
            <col className={DATE_COLUMN_WIDTH[dateFormats.updated]} />
            <col className="w-20" />
            <col className="w-10" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  className="ml-1 sm:ml-2"
                  aria-label={gt("Select all removable worktrees shown")}
                  checked={allSelected}
                  indeterminate={selectedVisible.length > 0 && !allSelected}
                  disabled={busy || !canRemove || removable.length === 0}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <SortableHead column="worktree" sort={sort} onSort={toggleSort}>
                <T>Worktree</T>
              </SortableHead>
              <SortableHead column="project" sort={sort} onSort={toggleSort}>
                <T>Project</T>
              </SortableHead>
              <SortableHead column="pullRequest" sort={sort} onSort={toggleSort}>
                <T context="column header, abbreviation of pull request">PR</T>
              </SortableHead>
              <SortableHead column="state" sort={sort} onSort={toggleSort}>
                <T context="worktree thread state">State</T>
              </SortableHead>
              <SortableHead column="checkout" sort={sort} onSort={toggleSort}>
                <T context="noun, a git working copy">Checkout</T>
              </SortableHead>
              {(["created", "updated"] as const).map((column) => (
                <SortableHead
                  key={column}
                  column={column}
                  sort={sort}
                  onSort={toggleSort}
                  align="end"
                  action={
                    <DateFormatMenu
                      column={column}
                      value={dateFormats[column]}
                      onChange={setDateFormat(column)}
                    />
                  }
                >
                  {column === "created" ? (
                    <T context="column header, creation date">Created</T>
                  ) : (
                    <T context="column header, last update date">Updated</T>
                  )}
                </SortableHead>
              ))}
              <SortableHead column="size" sort={sort} onSort={toggleSort} align="end">
                <T context="column header, disk size">Size</T>
              </SortableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center">
                  <p className="py-4 text-muted-foreground">
                    <T>No worktrees match these filters.</T>
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              visible.map((entry) => {
                const checkout = worktreeCheckout(entry);
                const safe = checkout === "clean";
                return (
                  <TableRow
                    key={entry.path}
                    data-state={selected.has(entry.path) && safe ? "selected" : undefined}
                    className="group"
                  >
                    <TableCell>
                      <Checkbox
                        className="ml-1 sm:ml-2"
                        aria-label={gt("Select {name}", { name: entry.branch ?? entry.path })}
                        checked={safe && selected.has(entry.path)}
                        disabled={busy || !canRemove || !safe}
                        onCheckedChange={(checked) => toggleOne(entry.path, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger
                          delay={400}
                          render={<div className="truncate font-medium" />}
                        >
                          {entry.branch ?? (
                            <span className="text-muted-foreground">
                              <T>Detached HEAD</T>
                            </span>
                          )}
                        </TooltipTrigger>
                        <TooltipPopup side="top">{entry.path}</TooltipPopup>
                      </Tooltip>
                      <ThreadSummary environmentId={environmentId} threads={entry.threads} />
                    </TableCell>
                    <TableCell>
                      <div className="truncate text-muted-foreground">{entry.repositoryName}</div>
                    </TableCell>
                    <TableCell>
                      <PullRequestCell pullRequest={entry.pullRequest} />
                    </TableCell>
                    <TableCell>
                      <StateLabel state={entry.state} />
                    </TableCell>
                    <TableCell>
                      <CheckoutCell checkout={checkout} />
                    </TableCell>
                    {(["created", "updated"] as const).map((column) => (
                      <TableCell key={column} className="text-right">
                        <div
                          className={cn(
                            "truncate tabular-nums",
                            column === "created" && "text-muted-foreground",
                          )}
                        >
                          {formatWorktreeDate(
                            column === "created" ? entry.createdAt : entry.updatedAt,
                            dateFormats[column],
                            timestampFormat,
                            loadedAtMs,
                          )}
                        </div>
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <SizeControl
                        bytes={sizes[entry.path]}
                        measuring={measuring.has(entry.path)}
                        onMeasure={() => void measure([entry.path])}
                      />
                    </TableCell>
                    <TableCell>
                      {safe && canRemove ? (
                        // Shown on row hover or focus; touch screens have no hover, so always there.
                        <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                          <Button
                            size="icon-xs"
                            variant="ghost-destructive"
                            aria-label={gt("Remove {name}", { name: entry.branch ?? entry.path })}
                            disabled={busy}
                            onClick={() => void prune([entry.path])}
                          >
                            <Trash2Icon />
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}
      {worktrees.length > 0 ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          <T>
            <Var>{visible.length}</Var> of <Var>{worktrees.length}</Var> shown ·{" "}
            <Var>{removable.length}</Var> removable
          </T>
        </p>
      ) : null}
    </div>
  );
}

export function WorktreeInventorySection() {
  const { connectedEnvironments } = useSettingsScope();
  const gt = useGT();
  return (
    <SettingsSection id="storage-worktree-inventory" title={gt("Managed worktrees")}>
      <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">
        <T>
          Review worktrees on each selected machine. Sizes are measured on demand. Removal keeps
          branches and thread history; running threads and local changes are protected.
        </T>
      </p>
      {connectedEnvironments.map((environment) =>
        environment.serverConfig?.environment.capabilities.worktreeInventory === true ? (
          <WorktreesOnEnvironment
            key={environment.environmentId}
            environmentId={environment.environmentId}
            name={environment.serverConfig.environment.label ?? environment.environmentId}
          />
        ) : (
          <p
            key={environment.environmentId}
            className="px-3 py-3 text-sm text-muted-foreground sm:px-4"
          >
            <T>
              Update <Var>{environment.environmentId}</Var> to review its worktrees.
            </T>
          </p>
        ),
      )}
    </SettingsSection>
  );
}
