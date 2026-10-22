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
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "active", label: "Active", Icon: CircleDotIcon },
  { value: "settled", label: "Settled", Icon: CircleCheckIcon },
  { value: "archived", label: "Archived", Icon: ArchiveIcon },
  { value: "none", label: "No thread", Icon: CircleDashedIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<WorktreeFilters["state"]>>;

const CHECKOUT_OPTIONS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "clean", label: "Clean", Icon: CircleCheckIcon },
  { value: "dirty", label: "Local changes", Icon: PenLineIcon },
  { value: "running", label: "Running", Icon: LoaderIcon },
  { value: "unknown", label: "Unreadable", Icon: EyeOffIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<WorktreeFilters["checkout"]>>;

const PULL_REQUEST_OPTIONS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "open", label: "Open", Icon: PullRequestGlyph.pullRequest },
  { value: "merged", label: "Merged", Icon: PullRequestGlyph.merged },
  { value: "closed", label: "Closed", Icon: PullRequestGlyph.closed },
  { value: "unsynced", label: "Not synced", Icon: PullRequestGlyph.pullRequest },
  { value: "none", label: "No pull request", Icon: CircleDashedIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<WorktreeFilters["pullRequest"]>>;

const STATE_DOT: Record<ManagedWorktree["state"], string> = {
  active: "bg-info",
  settled: "bg-success",
  archived: "bg-muted-foreground/60",
  none: "border border-muted-foreground/60",
};

const DATE_FORMAT_LABELS: Record<WorktreeDateFormat, string> = {
  relative: "Relative",
  date: "Date",
  datetime: "Date and time",
};
const DATE_COLUMN_WIDTH: Record<WorktreeDateFormat, string> = {
  relative: "w-18",
  date: "w-28",
  datetime: "w-40",
};

function CheckoutCell({ checkout }: { checkout: WorktreeCheckout }) {
  switch (checkout) {
    case "clean":
      return <span className="text-muted-foreground">Clean</span>;
    case "dirty":
      return (
        <Badge size="sm" variant="warning">
          Local changes
        </Badge>
      );
    case "running":
      return (
        <Badge size="sm" variant="info">
          Running
        </Badge>
      );
    case "unknown":
      return (
        <Badge size="sm" variant="outline">
          Unreadable
        </Badge>
      );
  }
}

function PullRequestCell({ pullRequest }: { pullRequest: ManagedWorktree["pullRequest"] }) {
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
      aria-label={`Pull request ${pullRequest.number}, ${presentation ? presentation.label.toLowerCase() : "state not synced"}`}
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
  label,
  value,
  onChange,
}: {
  label: string;
  value: WorktreeDateFormat;
  onChange: (format: WorktreeDateFormat) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${label} format`}
        render={<Button size="icon-micro" variant="ghost-muted" />}
      >
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <MenuGroupLabel>Show {label.toLowerCase()} as</MenuGroupLabel>
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as WorktreeDateFormat)}
        >
          {(Object.keys(DATE_FORMAT_LABELS) as WorktreeDateFormat[]).map((format) => (
            <MenuRadioItem key={format} value={format}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex-1">{DATE_FORMAT_LABELS[format]}</span>
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
  const projectOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "all", label: "All projects", Icon: LayersIcon },
    ...[...new Set(worktrees.map((entry) => entry.repositoryName))]
      .toSorted((left, right) => left.localeCompare(right))
      .map((name) => ({ value: name, label: name, Icon: FolderIcon })),
  ];
  const activeCount = Object.values(filters).filter((value) => value !== "all").length;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>
        <ListFilterIcon className="size-4" />
        <span>Filters</span>
        {activeCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {activeCount}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <PullRequestFilterRadioSubmenu
          label="State"
          value={filters.state}
          options={STATE_OPTIONS}
          counts={countWorktreeFacet(worktrees, "state")}
          onChange={(state) => onFilters({ ...filters, state })}
        />
        <PullRequestFilterRadioSubmenu
          label="Checkout"
          value={filters.checkout}
          options={CHECKOUT_OPTIONS}
          counts={countWorktreeFacet(worktrees, "checkout")}
          onChange={(checkout) => onFilters({ ...filters, checkout })}
        />
        <PullRequestFilterRadioSubmenu
          label="Pull request"
          value={filters.pullRequest}
          options={PULL_REQUEST_OPTIONS}
          counts={countWorktreeFacet(worktrees, "pullRequest")}
          onChange={(pullRequest) => onFilters({ ...filters, pullRequest })}
        />
        <MenuSeparator />
        <PullRequestFilterRadioSubmenu
          label="Project"
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
        label={prefix ? `${prefix}: ${option.label}` : option.label}
        onRemove={() => onFilters({ ...filters, [key]: "all" })}
      />
    );
  };
  const pills = [
    pill("state", STATE_OPTIONS),
    pill("checkout", CHECKOUT_OPTIONS, "Checkout"),
    pill("pullRequest", PULL_REQUEST_OPTIONS, "Pull request"),
    pill("project", []),
  ].filter((entry) => entry !== null);
  if (pills.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1">{pills}</div>;
}

const SORT_OPTIONS = [
  { value: "updated:desc", label: "Recently updated", Icon: ClockIcon },
  { value: "updated:asc", label: "Least recently updated", Icon: HistoryIcon },
  { value: "created:desc", label: "Newest", Icon: CalendarArrowDownIcon },
  { value: "created:asc", label: "Oldest", Icon: CalendarArrowUpIcon },
  { value: "size:desc", label: "Largest", Icon: Maximize2Icon },
  { value: "size:asc", label: "Smallest", Icon: Minimize2Icon },
  { value: "project:asc", label: "Project", Icon: FolderIcon },
  { value: "worktree:asc", label: "Branch", Icon: GitBranchIcon },
  { value: "state:desc", label: "State", Icon: CircleDotIcon },
  { value: "checkout:desc", label: "Checkout", Icon: CircleCheckIcon },
] as const satisfies ReadonlyArray<
  PullRequestFilterOption<`${WorktreeSortColumn}:${WorktreeSort["direction"]}`>
>;

function StateLabel({ state }: { state: ManagedWorktree["state"] }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} />
      {STATE_OPTIONS.find((option) => option.value === state)?.label}
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
  if (!first) return <div className="truncate text-muted-foreground/70">No thread</div>;
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
  if (measuring) return <span className="text-muted-foreground">Measuring…</span>;
  if (typeof bytes === "number") return <span className="tabular-nums">{formatBytes(bytes)}</span>;
  return (
    <Button
      size="micro"
      variant="ghost-muted"
      aria-label={bytes === null ? "Size unavailable. Measure again" : undefined}
      onClick={onMeasure}
    >
      {bytes === null ? "Retry" : "Measure"}
    </Button>
  );
}

function removalNotice(results: WorktreeInventoryRemoveResult["results"]): string {
  const removed = results.filter((entry) => entry.outcome === "removed").length;
  const refused = results.filter((entry) => entry.outcome !== "removed");
  const reasons = [...new Set(refused.map((entry) => entry.outcome.replaceAll("_", " ")))];
  return `Removed ${removed} worktree${removed === 1 ? "" : "s"}.${refused.length ? ` Kept ${refused.length}: ${reasons.join(", ")}.` : ""}`;
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

  const refresh = async () => {
    setBusy(true);
    const result = await list({ environmentId, input: {} });
    setBusy(false);
    if (result._tag === "Success") {
      setWorktrees(result.value.worktrees);
      setLoadedAtMs(Date.now());
      setSelected(new Set());
    } else setNotice("Could not load worktrees. Refresh to try again.");
  };
  useEffect(() => {
    let cancelled = false;
    void list({ environmentId, input: {} }).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (result._tag === "Success") {
        setWorktrees(result.value.worktrees);
        setLoadedAtMs(Date.now());
      } else setNotice("Could not load worktrees. Refresh to try again.");
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
    const message = `Remove ${paths.length} worktree${paths.length === 1 ? "" : "s"} from ${name}? Branches and thread history are kept. Clean checkouts can be recreated when threads resume. Running work and local changes are always protected.`;
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
            ? `${removalNotice(results)} Could not remove the rest.`
            : "Could not remove worktrees.",
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
            {worktrees.length} worktree{worktrees.length === 1 ? "" : "s"}
            {measured.length > 0
              ? ` · ${formatBytes(measuredBytes)}${measured.length < worktrees.length ? ` across ${measured.length} measured` : ""}`
              : ""}
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
              placeholder="Search branches, paths, threads"
              aria-label="Search worktrees"
            />
          </InputGroup>
          {narrow ? (
            <PullRequestCompactFilterMenu
              label="Sort worktrees"
              triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
              triggerLabel="Sort"
              outlined
              value={`${sort.column}:${sort.direction}`}
              options={SORT_OPTIONS}
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
            {measuring.size > 0 ? `Measuring ${measuring.size}…` : "Measure all"}
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Refresh worktrees"
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
              {selectedVisible.length} selected
              {selectedBytes > 0 ? ` · frees ${formatBytes(selectedBytes)}` : ""}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={busy || !canRemove}
              onClick={() => void prune(selectedVisible.map((entry) => entry.path))}
            >
              <Trash2Icon />
              Remove {selectedVisible.length}
            </Button>
          </div>
        )}
      </div>
      {busy && worktrees.length === 0 ? (
        <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
          Loading…
        </p>
      ) : worktrees.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">No managed worktrees.</p>
      ) : narrow ? (
        <div className="border-t border-border/50">
          <label className="flex items-center gap-2.5 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedVisible.length > 0 && !allSelected}
              disabled={busy || !canRemove || removable.length === 0}
              onCheckedChange={toggleAll}
            />
            Select all removable
          </label>
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No worktrees match these filters.
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
                    aria-label={`Select ${entry.branch ?? entry.path}`}
                    checked={safe && selected.has(entry.path)}
                    disabled={busy || !canRemove || !safe}
                    onCheckedChange={(checked) => toggleOne(entry.path, checked)}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {entry.branch ?? <span className="text-muted-foreground">Detached HEAD</span>}
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
                      updated{" "}
                      {formatWorktreeDate(
                        entry.updatedAt,
                        dateFormats.updated,
                        timestampFormat,
                        loadedAtMs,
                      )}
                    </span>
                    {safe && canRemove ? (
                      <Button
                        size="icon-xs"
                        variant="ghost-destructive"
                        aria-label={`Remove ${entry.branch ?? entry.path}`}
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
                  aria-label="Select all removable worktrees shown"
                  checked={allSelected}
                  indeterminate={selectedVisible.length > 0 && !allSelected}
                  disabled={busy || !canRemove || removable.length === 0}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <SortableHead column="worktree" sort={sort} onSort={toggleSort}>
                Worktree
              </SortableHead>
              <SortableHead column="project" sort={sort} onSort={toggleSort}>
                Project
              </SortableHead>
              <SortableHead column="pullRequest" sort={sort} onSort={toggleSort}>
                PR
              </SortableHead>
              <SortableHead column="state" sort={sort} onSort={toggleSort}>
                State
              </SortableHead>
              <SortableHead column="checkout" sort={sort} onSort={toggleSort}>
                Checkout
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
                      label={column === "created" ? "Created" : "Updated"}
                      value={dateFormats[column]}
                      onChange={setDateFormat(column)}
                    />
                  }
                >
                  {column === "created" ? "Created" : "Updated"}
                </SortableHead>
              ))}
              <SortableHead column="size" sort={sort} onSort={toggleSort} align="end">
                Size
              </SortableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center">
                  <p className="py-4 text-muted-foreground">No worktrees match these filters.</p>
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
                        aria-label={`Select ${entry.branch ?? entry.path}`}
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
                            <span className="text-muted-foreground">Detached HEAD</span>
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
                            aria-label={`Remove ${entry.branch ?? entry.path}`}
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
          {visible.length} of {worktrees.length} shown · {removable.length} removable
        </p>
      ) : null}
    </div>
  );
}

export function WorktreeInventorySection() {
  const { connectedEnvironments } = useSettingsScope();
  return (
    <SettingsSection id="storage-worktree-inventory" title="Managed worktrees">
      <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">
        Review worktrees on each selected machine. Sizes are measured on demand. Removal keeps
        branches and thread history; running threads and local changes are protected.
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
            Update {environment.environmentId} to review its worktrees.
          </p>
        ),
      )}
    </SettingsSection>
  );
}
