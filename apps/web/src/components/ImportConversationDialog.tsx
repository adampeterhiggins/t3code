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
import { useMemo, useState, type ReactNode } from "react";

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
import { DiscoveryList, DiscoveryListRow } from "./ui/discovery-list";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { MenuSelect } from "./ui/menu-select";
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
  const projectPicker = (
    <MenuSelect
      aria-label="Project to import into"
      value={selectedKey}
      onValueChange={setChosenKey}
      options={[
        { value: ALL_PROJECTS, label: "All projects" },
        ...projects.map((candidate) => ({
          value: scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)),
          label: candidate.title,
        })),
      ]}
    />
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeImportConversationDialog();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
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
              projectPicker={projectPicker}
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

function rowAction(pending: boolean, imported: boolean) {
  return pending ? (
    <Spinner size="xs" />
  ) : (
    <span className="text-muted-foreground text-xs">{imported ? "Open" : "Import"}</span>
  );
}

const CONDUCTOR_AGENT: Record<ConductorAgent, { driver: ProviderDriverKind; label: string }> = {
  claude: { driver: ProviderDriverKind.make("claudeAgent"), label: "Claude Code" },
  codex: { driver: ProviderDriverKind.make("codex"), label: "Codex" },
  cursor: { driver: ProviderDriverKind.make("cursor"), label: "Cursor" },
};

/** Project when listing several, folder, tab count with the tabs on hover, and age. */
function WorkspaceDescription({
  workspace,
  projectTitle,
}: {
  workspace: ConductorWorkspaceSummary;
  projectTitle: string | null;
}) {
  const tabs = workspace.tabs.length;
  return (
    <>
      {projectTitle === null ? null : `${projectTitle} · `}
      {workspace.name} ·{" "}
      <Tooltip>
        <TooltipTrigger
          render={<span className="underline decoration-dotted underline-offset-2" />}
        >
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
      </Tooltip>{" "}
      · {formatRelativeTimeLabel(workspace.updatedAt)}
    </>
  );
}

const sessionKey = (session: AgentSessionSummary) =>
  `${session.providerInstanceId}:${session.providerSessionId}`;

function describeSession(session: AgentSessionSummary, projectTitle: string | null): string {
  return [
    projectTitle,
    session.preview !== session.title ? session.preview : null,
    `${session.messageCount} ${session.messageCount === 1 ? "message" : "messages"}`,
    formatRelativeTimeLabel(session.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ImportConversationList({
  projects,
  showProject,
  projectPicker,
}: {
  projects: ReadonlyArray<EnvironmentProject>;
  showProject: boolean;
  projectPicker: ReactNode;
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
        : "conductor"
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
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    (option) => ({ value: option, label: SOURCE_LABEL[option] }),
  );

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        {projectPicker}
        <MenuSelect
          aria-label="Choose where to import from"
          value={source}
          onValueChange={setSource}
          count={rows.length === 0 && pending ? undefined : visibleRows.length}
          options={sourceOptions}
        />
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
        <div className="max-h-[28rem] overflow-y-auto">
          <DiscoveryList>
            {visibleRows.map((row) => {
              const projectTitle = showProject ? row.project.title : null;
              if (row.kind === "session") {
                const { session } = row;
                const key = sessionKey(session);
                return (
                  <DiscoveryListRow
                    key={key}
                    icon={
                      <ProviderInstanceIcon
                        driverKind={ProviderDriverKind.make(session.provider)}
                        displayName={PROVIDER_LABEL[session.provider]}
                        showBadge={false}
                        iconClassName="size-4"
                      />
                    }
                    title={session.title}
                    description={describeSession(session, projectTitle)}
                    disabled={pendingKey !== null}
                    aria-label={`${session.threadId ? "Open" : "Import"} ${session.title}`}
                    onClick={() => void choose(row.project, session)}
                    action={rowAction(pendingKey === key, session.threadId !== null)}
                  />
                );
              }
              const { workspace } = row;
              const key = `conductor:${workspace.workspaceId}`;
              const agent = CONDUCTOR_AGENT[workspace.tabs[0]!.agent];
              return (
                <DiscoveryListRow
                  key={key}
                  icon={
                    <ProviderInstanceIcon
                      driverKind={agent.driver}
                      displayName={agent.label}
                      showBadge={false}
                      iconClassName="size-4"
                    />
                  }
                  title={workspace.title}
                  description={
                    <WorkspaceDescription workspace={workspace} projectTitle={projectTitle} />
                  }
                  disabled={pendingKey !== null}
                  aria-label={`${workspace.threadId ? "Open" : "Import"} ${workspace.title}`}
                  onClick={() => void chooseWorkspace(row.project, workspace)}
                  action={rowAction(pendingKey === key, workspace.threadId !== null)}
                />
              );
            })}
          </DiscoveryList>
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
