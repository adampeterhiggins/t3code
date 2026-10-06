import { useAtomValue } from "@effect/atom-react";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProviderDriverKind,
  type AgentSessionSummary,
  type ConductorAgent,
  type ConductorWorkspaceSummary,
  type EnvironmentId,
  type ProjectId,
  type ScopedProjectRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LayersIcon,
  ListFilterIcon,
} from "lucide-react";
import { useMemo, useState, type ElementType } from "react";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  agentSessionImport,
  agentSessionList,
  conductorWorkspaceImport,
  conductorWorkspaceList,
} from "~/state/agentSessions";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useProjects, useServerConfigs, waitForThreadShell } from "~/state/entities";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import {
  PullRequestFilterRadioSubmenu,
  type PullRequestFilterOption,
} from "./pullRequest/PullRequestListFilters";
import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** `null` while closed; open, it holds the project the dialog starts on, if any. */
const importConversationAtom = Atom.make<{ readonly projectRef: ScopedProjectRef | null } | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("import-conversation:open"));

/**
 * Opens the picker of Claude Code and Codex conversations and active Conductor workspaces,
 * starting on `projectRef` when given. The dialog can switch to any other project.
 */
export function openImportConversationDialog(projectRef: ScopedProjectRef | null = null): void {
  appAtomRegistry.set(importConversationAtom, { projectRef });
}

function closeImportConversationDialog() {
  appAtomRegistry.set(importConversationAtom, null);
}

export function ImportConversationDialogHost() {
  const open = useAtomValue(importConversationAtom);
  if (open === null) return null;
  return <ImportConversationDialog initialProjectRef={open.projectRef} />;
}

/** Projects whose server can list importable conversations, most recently updated first. */
function useImportableProjects() {
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { scratchWorkspaceRootFor } = useScratchProject();
  return useMemo(
    () =>
      projects
        .filter(
          (project) =>
            serverConfigs.get(project.environmentId)?.environment.capabilities
              .agentSessionPicker === true &&
            !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)),
        )
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [projects, serverConfigs, scratchWorkspaceRootFor],
  );
}

function ImportConversationDialog({
  initialProjectRef,
}: {
  initialProjectRef: ScopedProjectRef | null;
}) {
  const projects = useImportableProjects();
  const [chosenKey, setChosenKey] = useState(
    initialProjectRef === null ? ALL_PROJECTS : scopedProjectKey(initialProjectRef),
  );
  const chosen = projects.filter(
    (candidate) =>
      chosenKey === ALL_PROJECTS ||
      scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)) === chosenKey,
  );
  // A project that went away falls back to all of them.
  const selectedKey = chosen.length === 0 ? ALL_PROJECTS : chosenKey;
  const selected = chosen.length === 0 ? projects : chosen;
  const projectFilter: ImportFilter<string> = {
    value: selectedKey,
    onChange: setChosenKey,
    options: [
      { value: ALL_PROJECTS, label: "All projects", Icon: LayersIcon },
      ...projects.map((candidate) => ({
        value: scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)),
        label: candidate.title,
        Icon: FolderGit2Icon,
        project: candidate,
      })),
    ],
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeImportConversationDialog();
      }}
    >
      <DialogPopup className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import conversation</DialogTitle>
          <DialogDescription>
            Claude Code and Codex conversations from the last 30 days, and active Conductor
            workspaces, for your projects. An imported conversation continues the same session.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {projects.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
              Add a project to import conversations into it.
            </div>
          ) : (
            <ImportConversationList
              key={selectedKey}
              projects={selected}
              showProject={selectedKey === ALL_PROJECTS && projects.length > 1}
              projectFilter={projectFilter}
            />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

const PROVIDER_LABEL: Record<AgentSessionSummary["provider"], string> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
};

const SOURCES = ["all", "claudeAgent", "codex", "conductor"] as const;
type ImportSource = (typeof SOURCES)[number];

const SOURCE_LABEL: Record<ImportSource, string> = {
  all: "All",
  claudeAgent: "Claude Code",
  codex: "Codex",
  conductor: "Conductor",
};

type ImportRow =
  | {
      kind: "session";
      project: EnvironmentProject;
      session: AgentSessionSummary;
      updatedAt: string;
    }
  | {
      kind: "workspace";
      project: EnvironmentProject;
      workspace: ConductorWorkspaceSummary;
      updatedAt: string;
    };

const ALL_PROJECTS = "all-projects";

/**
 * Both listings for each project, keyed by the projects' JSON so the dialog subscribes to one
 * atom however many projects it shows.
 */
const importListingsAtom = Atom.family((targetsJson: string) =>
  Atom.make((get) =>
    (
      JSON.parse(targetsJson) as ReadonlyArray<{
        readonly environmentId: EnvironmentId;
        readonly projectId: ProjectId;
      }>
    ).map(({ environmentId, projectId }) => ({
      sessions: get(agentSessionList({ environmentId, input: { projectId } })),
      conductor: get(conductorWorkspaceList({ environmentId, input: { projectId } })),
    })),
  ),
);

/** Whether a row's titles, prompt, folder, or branch contain the lowercased search text. */
function matchesSearch(row: ImportRow, needle: string): boolean {
  if (needle === "") return true;
  const fields =
    row.kind === "session"
      ? [row.session.title, row.session.preview]
      : [
          row.workspace.title,
          row.workspace.name,
          row.workspace.branch ?? "",
          ...row.workspace.tabs.map((tab) => tab.title),
        ];
  return fields.some((field) => field.toLowerCase().includes(needle));
}

/** The project and source rows of the Filters menu. */
interface ImportFilter<Value extends string> {
  readonly value: Value;
  readonly options: ReadonlyArray<PullRequestFilterOption<Value>>;
  readonly onChange: (value: Value) => void;
}

const DEFAULT_SOURCE: ImportSource = "conductor";

function providerIcon(driver: string, label: string) {
  return function ProviderIcon({ className }: { className?: string }) {
    return (
      <ProviderInstanceIcon
        driverKind={ProviderDriverKind.make(driver)}
        displayName={label}
        showBadge={false}
        iconClassName={className ?? "size-3.5"}
      />
    );
  };
}

const SOURCE_ICON: Record<ImportSource, ElementType<{ className?: string }>> = {
  all: LayersIcon,
  claudeAgent: providerIcon("claudeAgent", "Claude Code"),
  codex: providerIcon("codex", "Codex"),
  conductor: GitBranchIcon,
};

const CONDUCTOR_AGENT: Record<ConductorAgent, { driver: ProviderDriverKind; label: string }> = {
  claude: { driver: ProviderDriverKind.make("claudeAgent"), label: "Claude Code" },
  codex: { driver: ProviderDriverKind.make("codex"), label: "Codex" },
  cursor: { driver: ProviderDriverKind.make("cursor"), label: "Cursor" },
};

/** "9 tabs", listing each tab's agent, title, and prompt count on hover. */
function TabCount({ workspace }: { workspace: ConductorWorkspaceSummary }) {
  const tabs = workspace.tabs.length;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="underline decoration-dotted underline-offset-2" />}>
        {tabs} {tabs === 1 ? "tab" : "tabs"}
      </TooltipTrigger>
      <TooltipPopup align="start">
        <ul className="flex max-w-80 flex-col gap-1">
          {workspace.tabs.map((tab) => (
            <li key={tab.sessionId} className="flex min-w-0 items-center gap-2">
              <ProviderInstanceIcon
                driverKind={CONDUCTOR_AGENT[tab.agent].driver}
                displayName={CONDUCTOR_AGENT[tab.agent].label}
                showBadge={false}
                iconClassName="size-3"
              />
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <span className="shrink-0 text-muted-foreground">
                {tab.messageCount} {tab.messageCount === 1 ? "prompt" : "prompts"}
              </span>
            </li>
          ))}
        </ul>
      </TooltipPopup>
    </Tooltip>
  );
}

const sessionKey = (session: AgentSessionSummary) =>
  `${session.providerInstanceId}:${session.providerSessionId}`;

const rowKey = (row: ImportRow) =>
  row.kind === "session" ? sessionKey(row.session) : `conductor:${row.workspace.workspaceId}`;

const rowTitle = (row: ImportRow) =>
  row.kind === "session" ? row.session.title : row.workspace.title;

const rowSource = (row: ImportRow) =>
  row.kind === "session" ? PROVIDER_LABEL[row.session.provider] : "Conductor";

type SortKey = "name" | "project" | "source" | "updated";
interface Sort {
  readonly key: SortKey;
  readonly descending: boolean;
}
const DEFAULT_SORT: Sort = { key: "updated", descending: true };

function ariaSort(sort: Sort, column: SortKey) {
  if (sort.key !== column) return "none" as const;
  return sort.descending ? ("descending" as const) : ("ascending" as const);
}

function compareRows(left: ImportRow, right: ImportRow, key: SortKey): number {
  switch (key) {
    case "name":
      return rowTitle(left).localeCompare(rowTitle(right));
    case "project":
      return left.project.title.localeCompare(right.project.title);
    case "source":
      return rowSource(left).localeCompare(rowSource(right));
    case "updated":
      return left.updatedAt.localeCompare(right.updatedAt);
  }
}

/** A column header that sorts by its column; pressing the sorted one flips the direction. */
function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const active = sort.key === column;
  const Arrow = sort.descending ? ArrowDownIcon : ArrowUpIcon;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      onClick={() =>
        onSort(
          active
            ? { key: column, descending: !sort.descending }
            : { key: column, descending: column === "updated" },
        )
      }
    >
      {label}
      {active ? <Arrow aria-hidden className="size-3" /> : null}
    </button>
  );
}

function ImportConversationList({
  projects,
  showProject,
  projectFilter,
}: {
  projects: ReadonlyArray<EnvironmentProject>;
  showProject: boolean;
  projectFilter: ImportFilter<string>;
}) {
  const navigate = useNavigate();
  const listings = useAtomValue(
    importListingsAtom(
      JSON.stringify(
        projects.map((project) => ({
          environmentId: project.environmentId,
          projectId: project.id,
        })),
      ),
    ),
  );
  const importSession = useAtomCommand(agentSessionImport, { reportFailure: false });
  const importWorkspace = useAtomCommand(conductorWorkspaceImport, { reportFailure: false });
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [chosenSource, setSource] = useState<ImportSource | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);

  const openThread = (project: EnvironmentProject, threadId: ThreadId) => {
    closeImportConversationDialog();
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: project.environmentId, threadId },
    });
  };

  const choose = async (project: EnvironmentProject, session: AgentSessionSummary) => {
    if (pendingKey !== null) return;
    if (session.threadId !== null) {
      openThread(project, session.threadId);
      return;
    }
    const { environmentId } = project;
    setPendingKey(sessionKey(session));
    const result = await importSession({
      environmentId,
      input: {
        projectId: project.id,
        expectedWorkspaceRoot: project.workspaceRoot,
        session: {
          providerInstanceId: session.providerInstanceId,
          providerSessionId: session.providerSessionId,
        },
      },
    });
    if (result._tag === "Success") {
      const threadId = result.value.threadIds?.[0];
      appAtomRegistry.refresh(
        agentSessionList({ environmentId, input: { projectId: project.id } }),
      );
      if (threadId) {
        // The route treats a thread the client has not heard of yet as missing.
        await waitForThreadShell(scopeThreadRef(environmentId, threadId)).catch(() => null);
        setPendingKey(null);
        openThread(project, threadId);
        return;
      }
      setPendingKey(null);
      toastManager.add({
        type: "error",
        title: "Could not import conversation",
        description: "It may have changed on disk, or an earlier import of it was deleted.",
      });
      return;
    }
    setPendingKey(null);
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Could not import conversation",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };

  const chooseWorkspace = async (
    project: EnvironmentProject,
    workspace: ConductorWorkspaceSummary,
  ) => {
    if (pendingKey !== null) return;
    if (workspace.threadId !== null) {
      openThread(project, workspace.threadId);
      return;
    }
    const { environmentId } = project;
    setPendingKey(`conductor:${workspace.workspaceId}`);
    const result = await importWorkspace({
      environmentId,
      input: { projectId: project.id, workspaceId: workspace.workspaceId },
    });
    if (result._tag === "Success" && result.value.threadIds[0] !== undefined) {
      const threadId = result.value.threadIds[0];
      appAtomRegistry.refresh(
        conductorWorkspaceList({ environmentId, input: { projectId: project.id } }),
      );
      await waitForThreadShell(scopeThreadRef(environmentId, threadId)).catch(() => null);
      setPendingKey(null);
      openThread(project, threadId);
      return;
    }
    setPendingKey(null);
    if (result._tag !== "Success" && isAtomCommandInterrupted(result)) return;
    const error = result._tag === "Success" ? null : squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Could not import Conductor workspace",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };

  const loaded = listings.map((listing) => ({
    sessions: Option.getOrNull(AsyncResult.value(listing.sessions)),
    conductor: Option.getOrNull(AsyncResult.value(listing.conductor)),
  }));
  // Conductor leads while its listing loads; without Conductor on this machine, show everything.
  const conductorMissing =
    loaded.length > 0 && loaded.every((listing) => listing.conductor?.available === false);
  const source: ImportSource =
    chosenSource === null || (chosenSource === "conductor" && conductorMissing)
      ? conductorMissing
        ? "all"
        : DEFAULT_SOURCE
      : chosenSource;
  const showSessions = source !== "conductor";
  const showWorkspaces = source === "all" || source === "conductor";

  // Two projects of one repository list the same workspaces; the first one keeps them.
  const seen = new Set<string>();
  const rows: Array<ImportRow> = [];
  projects.forEach((project, index) => {
    const listing = loaded[index];
    if (showSessions) {
      for (const session of listing?.sessions?.sessions ?? []) {
        if (source !== "all" && session.provider !== source) continue;
        if (seen.has(sessionKey(session))) continue;
        seen.add(sessionKey(session));
        rows.push({ kind: "session", project, session, updatedAt: session.updatedAt });
      }
    }
    if (showWorkspaces) {
      for (const workspace of listing?.conductor?.workspaces ?? []) {
        const key = `conductor:${workspace.workspaceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ kind: "workspace", project, workspace, updatedAt: workspace.updatedAt });
      }
    }
  });
  const visibleRows = rows
    .filter((row) => matchesSearch(row, needle))
    .toSorted((left, right) => {
      const order = compareRows(left, right, sort.key) * (sort.descending ? -1 : 1);
      return order !== 0 ? order : right.updatedAt.localeCompare(left.updatedAt);
    });
  const relevant = listings.flatMap((listing) => [
    ...(showSessions ? [listing.sessions] : []),
    ...(showWorkspaces ? [listing.conductor] : []),
  ]);
  const pending = relevant.some(
    (result) => result._tag === "Initial" || (result._tag !== "Success" && result.waiting),
  );
  const failure = relevant.find((result) => result._tag === "Failure");
  const truncated = showSessions && loaded.some((listing) => listing.sessions?.truncated === true);
  const sourceOptions = SOURCES.filter((option) => option !== "conductor" || !conductorMissing).map(
    (option) => ({ value: option, label: SOURCE_LABEL[option], Icon: SOURCE_ICON[option] }),
  );
  const activeFilters =
    Number(projectFilter.value !== ALL_PROJECTS) + Number(source !== DEFAULT_SOURCE);

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <Menu>
          <MenuTrigger render={<Button type="button" variant="outline" size="xs" />}>
            <ListFilterIcon />
            <span>Filters</span>
            {activeFilters > 0 ? (
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                {activeFilters}
              </span>
            ) : null}
          </MenuTrigger>
          <MenuPopup align="start" side="bottom">
            <PullRequestFilterRadioSubmenu
              label="Project"
              value={projectFilter.value}
              options={projectFilter.options}
              onChange={projectFilter.onChange}
            />
            <PullRequestFilterRadioSubmenu
              label="Source"
              value={source}
              options={sourceOptions}
              onChange={setSource}
            />
          </MenuPopup>
        </Menu>
        <div className="min-w-0 flex-1">
          <Input
            size="compact"
            type="search"
            value={query}
            placeholder="Search"
            aria-label="Search conversations and workspaces"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {rows.length === 0 && (pending || failure !== undefined) ? (
        <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {pending ? (
            <Spinner size="md" tone="muted" />
          ) : failure?._tag === "Failure" ? (
            formatEnvironmentQueryError(failure.cause)
          ) : null}
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {needle !== ""
            ? `Nothing matches “${query.trim()}”.`
            : source === "conductor"
              ? "No active Conductor workspaces found."
              : source === "all"
                ? "Nothing to import."
                : `No ${SOURCE_LABEL[source]} conversations found.`}
        </div>
      ) : (
        <div>
          <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-border/70">
            <Table className="table-fixed" aria-label="Conversations and workspaces to import">
              <colgroup>
                <col />
                {showProject ? <col className="w-28" /> : null}
                <col className="w-36" />
                <col className="w-20" />
                <col className="w-20" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead aria-sort={ariaSort(sort, "name")}>
                    <SortHeader label="Name" column="name" sort={sort} onSort={setSort} />
                  </TableHead>
                  {showProject ? (
                    <TableHead aria-sort={ariaSort(sort, "project")}>
                      <SortHeader label="Project" column="project" sort={sort} onSort={setSort} />
                    </TableHead>
                  ) : null}
                  <TableHead aria-sort={ariaSort(sort, "source")}>
                    <SortHeader label="Source" column="source" sort={sort} onSort={setSort} />
                  </TableHead>
                  <TableHead aria-sort={ariaSort(sort, "updated")}>
                    <SortHeader label="Updated" column="updated" sort={sort} onSort={setSort} />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const key = rowKey(row);
                  const imported =
                    (row.kind === "session" ? row.session.threadId : row.workspace.threadId) !==
                    null;
                  const run = () =>
                    void (row.kind === "session"
                      ? choose(row.project, row.session)
                      : chooseWorkspace(row.project, row.workspace));
                  const agent =
                    row.kind === "session"
                      ? {
                          driver: ProviderDriverKind.make(row.session.provider),
                          label: PROVIDER_LABEL[row.session.provider],
                        }
                      : CONDUCTOR_AGENT[row.workspace.tabs[0]!.agent];
                  const subtitle =
                    row.kind === "session"
                      ? row.session.preview !== row.session.title
                        ? row.session.preview
                        : null
                      : row.workspace.name;
                  return (
                    <TableRow key={key} className="cursor-pointer" onClick={run}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProviderInstanceIcon
                            driverKind={agent.driver}
                            displayName={agent.label}
                            showBadge={false}
                            iconClassName="size-4"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground text-sm">
                              {rowTitle(row)}
                            </div>
                            {subtitle ? (
                              <div className="truncate text-muted-foreground">{subtitle}</div>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      {showProject ? (
                        <TableCell>
                          <div className="truncate text-muted-foreground">{row.project.title}</div>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="truncate text-muted-foreground">
                          {rowSource(row)} ·{" "}
                          {row.kind === "session" ? (
                            `${row.session.messageCount} msgs`
                          ) : (
                            <TabCount workspace={row.workspace} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="truncate text-muted-foreground">
                          {formatRelativeTimeLabel(row.updatedAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {pendingKey === key ? (
                          <Spinner size="xs" />
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={pendingKey !== null}
                            aria-label={`${imported ? "Open" : "Import"} ${rowTitle(row)}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              run();
                            }}
                          >
                            {imported ? "Open" : "Import"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {pending ? (
            <p className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner size="xs" /> Still loading some projects.
            </p>
          ) : truncated ? (
            <p className="mt-2 text-muted-foreground text-xs">
              Showing the newest 50 conversations per project.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
