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
  ArrowRightIcon,
  ArrowUpIcon,
  DownloadIcon,
  FolderGit2Icon,
  LayersIcon,
  ListFilterIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ElementType } from "react";

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
import { ConductorIcon } from "./Icons";
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
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Truncatable } from "./ui/truncatable";

/** `null` while closed; open, it holds the project the dialog starts on, if any. */
const importConversationAtom = Atom.make<{ readonly projectRef: ScopedProjectRef | null } | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("import-conversation:open"));

/**
 * Opens the picker of Claude Code and Codex conversations and Conductor workspaces,
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
            Claude Code and Codex conversations from the last 30 days, and Conductor workspaces, for
            your projects. An imported conversation continues the same session. Import all Conductor
            can include archived workspaces, which become settled threads.
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

/** Whether a row's conversation ID, titles, prompt, folder, or branch match the search text. */
function matchesSearch(row: ImportRow, needle: string): boolean {
  if (needle === "") return true;
  const fields =
    row.kind === "session"
      ? [row.session.providerSessionId, row.session.title, row.session.preview]
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

function countPhrase(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** What the import-all run should tell the user, or nothing when it was stopped before any work. */
function conductorImportToast(input: {
  readonly stopped: boolean;
  readonly importedThreads: number;
  readonly refreshedThreads: number;
  readonly settledThreads: number;
  readonly failed: number;
  readonly failureDetail: string | null;
}): {
  readonly type: "success" | "warning" | "error";
  readonly title: string;
  readonly description: string | undefined;
} | null {
  if (
    input.stopped &&
    input.importedThreads === 0 &&
    input.refreshedThreads === 0 &&
    input.failed === 0
  ) {
    return null;
  }
  const refreshed =
    input.refreshedThreads > 0
      ? `Updated ${countPhrase(input.refreshedThreads, "earlier imported thread")}.`
      : null;
  const settled =
    input.settledThreads > 0
      ? `${countPhrase(input.settledThreads, "archived thread")} ${input.settledThreads === 1 ? "is" : "are"} settled.`
      : null;
  const failed =
    input.failed > 0 ? `${countPhrase(input.failed, "workspace")} could not be imported.` : null;
  const description = [
    refreshed,
    settled,
    failed,
    input.importedThreads === 0 ? input.failureDetail : null,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ");
  if (!input.stopped && input.failed === 0 && input.importedThreads === 0) {
    return {
      type: "success",
      title:
        input.refreshedThreads > 0
          ? `Updated ${countPhrase(input.refreshedThreads, "imported thread")}`
          : "Conductor threads are already imported",
      description: undefined,
    };
  }
  return {
    type:
      input.failed > 0 && input.importedThreads === 0
        ? "error"
        : input.failed > 0 || input.stopped
          ? "warning"
          : "success",
    title: input.stopped
      ? `Stopped after importing ${countPhrase(input.importedThreads, "thread")}`
      : input.failed > 0 && input.importedThreads === 0
        ? "Could not import Conductor threads"
        : `Imported ${countPhrase(input.importedThreads, "thread")}`,
    description: description === "" ? undefined : description,
  };
}

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
  conductor: ConductorIcon,
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

type SortKey = "name" | "workspace" | "project" | "source" | "updated";

/** A Conductor workspace's folder; conversations have none and sort last. */
const rowWorkspace = (row: ImportRow) => (row.kind === "workspace" ? row.workspace.name : null);
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
    case "workspace": {
      const leftName = rowWorkspace(left);
      const rightName = rowWorkspace(right);
      if (leftName === null || rightName === null)
        return Number(leftName === null) - Number(rightName === null);
      return leftName.localeCompare(rightName);
    }
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
  alignEnd = false,
}: {
  label: string;
  column: SortKey;
  /** Right-aligned columns lead with the arrow so the label lines up with the values. */
  alignEnd?: boolean;
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
      {alignEnd && active ? <Arrow aria-hidden className="size-3" /> : null}
      {label}
      {!alignEnd && active ? <Arrow aria-hidden className="size-3" /> : null}
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
  const [includeArchived, setIncludeArchived] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const importRun = useRef<{ cancelled: boolean } | null>(null);
  useEffect(
    () => () => {
      if (importRun.current) importRun.current.cancelled = true;
    },
    [],
  );
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
  const conductorKnown = loaded.length > 0 && loaded.every((listing) => listing.conductor !== null);
  const showConductorImport = conductorKnown && !conductorMissing && showWorkspaces;
  const archivedIds = new Set<string>();
  for (const listing of loaded) {
    for (const workspaceId of listing.conductor?.archivedWorkspaceIds ?? []) {
      archivedIds.add(workspaceId);
    }
  }
  const importTargets: Array<{
    project: EnvironmentProject;
    workspaceId: string;
  }> = [];
  if (showWorkspaces) {
    const seenWorkspaceIds = new Set<string>();
    projects.forEach((project, index) => {
      const conductor = loaded[index]?.conductor;
      if (conductor === null || conductor === undefined) return;
      for (const workspace of conductor.workspaces) {
        if (seenWorkspaceIds.has(workspace.workspaceId)) continue;
        seenWorkspaceIds.add(workspace.workspaceId);
        importTargets.push({ project, workspaceId: workspace.workspaceId });
      }
      if (!includeArchived) return;
      for (const workspaceId of conductor.archivedWorkspaceIds) {
        if (seenWorkspaceIds.has(workspaceId)) continue;
        seenWorkspaceIds.add(workspaceId);
        importTargets.push({ project, workspaceId });
      }
    });
  }
  const importingAll = importProgress !== null;

  const importAll = async () => {
    if (importRun.current !== null || pendingKey !== null || importTargets.length === 0) return;
    const run = { cancelled: false };
    importRun.current = run;
    const targets = importTargets;
    setPendingKey("import-all");
    setImportProgress({ completed: 0, total: targets.length });
    let importedThreads = 0;
    let refreshedThreads = 0;
    let settledThreads = 0;
    let failed = 0;
    let failureDetail: string | null = null;
    const refreshProjects = new Map<string, EnvironmentProject>();
    for (const [index, target] of targets.entries()) {
      if (run.cancelled) break;
      const result = await importWorkspace({
        environmentId: target.project.environmentId,
        input: { projectId: target.project.id, workspaceId: target.workspaceId },
      });
      refreshProjects.set(
        scopedProjectKey(scopeProjectRef(target.project.environmentId, target.project.id)),
        target.project,
      );
      if (result._tag === "Success") {
        importedThreads += result.value.importedThreadCount;
        refreshedThreads += result.value.refreshedThreadCount;
        if (result.value.settled) settledThreads += result.value.importedThreadCount;
      } else if (isAtomCommandInterrupted(result)) {
        run.cancelled = true;
      } else {
        failed += 1;
        const error = squashAtomCommandFailure(result);
        failureDetail = error instanceof Error ? error.message : "An error occurred.";
      }
      setImportProgress({ completed: index + 1, total: targets.length });
      if (run.cancelled) break;
    }
    if (importRun.current === run) importRun.current = null;
    setPendingKey(null);
    setImportProgress(null);
    for (const project of refreshProjects.values()) {
      appAtomRegistry.refresh(
        conductorWorkspaceList({
          environmentId: project.environmentId,
          input: { projectId: project.id },
        }),
      );
    }
    const toast = conductorImportToast({
      stopped: run.cancelled,
      importedThreads,
      refreshedThreads,
      settledThreads,
      failed,
      failureDetail,
    });
    if (toast === null) return;
    toastManager.add({ type: toast.type, title: toast.title, description: toast.description });
  };

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <Menu>
          <MenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
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
            size="sm"
            type="search"
            value={query}
            placeholder="Search by title, prompt, or conversation ID"
            aria-label="Search conversations and workspaces"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {showConductorImport ? (
        <div className="mb-2 flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
              <Label>
                <Checkbox
                  checked={includeArchived}
                  disabled={importingAll || archivedIds.size === 0}
                  onCheckedChange={(checked) => setIncludeArchived(checked === true)}
                />
                Include archived
                {archivedIds.size > 0 ? (
                  <span className="text-muted-foreground tabular-nums">{archivedIds.size}</span>
                ) : null}
              </Label>
            </TooltipTrigger>
            <TooltipPopup>
              Archived Conductor workspaces become settled threads. Their folders are usually
              already gone, so the conversation comes across without a working copy.
            </TooltipPopup>
          </Tooltip>
          <div className="ml-auto flex items-center gap-2">
            {importingAll && importProgress !== null ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                {importProgress.completed} of {importProgress.total}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!importingAll && (importTargets.length === 0 || pending)}
              onClick={() => {
                if (importingAll) {
                  if (importRun.current) importRun.current.cancelled = true;
                  return;
                }
                void importAll();
              }}
            >
              {importingAll ? "Stop" : "Import all Conductor"}
            </Button>
          </div>
        </div>
      ) : null}
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
                <col className="w-28" />
                {showProject ? <col className="w-28" /> : null}
                <col className="w-36" />
                <col className="w-24" />
                <col className="w-12" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead aria-sort={ariaSort(sort, "name")}>
                    <SortHeader label="Name" column="name" sort={sort} onSort={setSort} />
                  </TableHead>
                  <TableHead aria-sort={ariaSort(sort, "workspace")}>
                    <SortHeader label="Workspace" column="workspace" sort={sort} onSort={setSort} />
                  </TableHead>
                  {showProject ? (
                    <TableHead aria-sort={ariaSort(sort, "project")}>
                      <SortHeader label="Project" column="project" sort={sort} onSort={setSort} />
                    </TableHead>
                  ) : null}
                  <TableHead aria-sort={ariaSort(sort, "source")}>
                    <SortHeader label="Source" column="source" sort={sort} onSort={setSort} />
                  </TableHead>
                  <TableHead aria-sort={ariaSort(sort, "updated")} className="text-right">
                    <SortHeader
                      label="Updated"
                      column="updated"
                      sort={sort}
                      onSort={setSort}
                      alignEnd
                    />
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
                  const prompt =
                    row.kind === "session" && row.session.preview !== row.session.title
                      ? row.session.preview
                      : null;
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
                          {prompt === null ? (
                            <span className="min-w-0 font-medium text-foreground text-sm">
                              <Truncatable>{rowTitle(row)}</Truncatable>
                            </span>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="min-w-0 truncate font-medium text-foreground text-sm" />
                                }
                              >
                                {rowTitle(row)}
                              </TooltipTrigger>
                              <TooltipPopup align="start" className="max-w-96 whitespace-normal">
                                <div className="font-medium">{rowTitle(row)}</div>
                                <div className="text-muted-foreground">{prompt}</div>
                              </TooltipPopup>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.kind === "workspace" ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={<div className="truncate text-muted-foreground" />}
                            >
                              {row.workspace.name}
                            </TooltipTrigger>
                            <TooltipPopup>{row.workspace.branch ?? "No branch"}</TooltipPopup>
                          </Tooltip>
                        ) : (
                          <div className="text-muted-foreground/50">—</div>
                        )}
                      </TableCell>
                      {showProject ? (
                        <TableCell>
                          <div className="text-muted-foreground">
                            <Truncatable>{row.project.title}</Truncatable>
                          </div>
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
                      <TableCell className="text-right">
                        <div className="truncate text-muted-foreground tabular-nums">
                          {formatRelativeTimeLabel(row.updatedAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                disabled={pendingKey !== null}
                                aria-label={`${imported ? "Open" : "Import"} ${rowTitle(row)}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  run();
                                }}
                              />
                            }
                          >
                            {pendingKey === key ? (
                              <Spinner size="xs" />
                            ) : imported ? (
                              <ArrowRightIcon aria-hidden />
                            ) : (
                              <DownloadIcon aria-hidden />
                            )}
                          </TooltipTrigger>
                          <TooltipPopup>{imported ? "Open thread" : "Import"}</TooltipPopup>
                        </Tooltip>
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
