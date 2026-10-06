import { useAtomValue } from "@effect/atom-react";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
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
  type ScopedProjectRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
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
import { useProject, useProjects, useServerConfigs, waitForThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
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
    initialProjectRef === null ? null : scopedProjectKey(initialProjectRef),
  );
  const project =
    projects.find(
      (candidate) =>
        scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)) === chosenKey,
    ) ??
    projects[0] ??
    null;
  const projectRef = project === null ? null : scopeProjectRef(project.environmentId, project.id);
  const projectPicker =
    project === null ? null : (
      <MenuSelect
        aria-label="Project to import into"
        value={scopedProjectKey(projectRef!)}
        onValueChange={setChosenKey}
        options={projects.map((candidate) => ({
          value: scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)),
          label: candidate.title,
        }))}
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
            workspaces, for the project you choose. An imported conversation continues the same
            session.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {projectRef === null ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
              Add a project to import conversations into it.
            </div>
          ) : (
            <ImportConversationList
              key={scopedProjectKey(projectRef)}
              projectRef={projectRef}
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
  | { kind: "session"; session: AgentSessionSummary; updatedAt: string }
  | { kind: "workspace"; workspace: ConductorWorkspaceSummary; updatedAt: string };

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

/** Folder, tab count with the tabs on hover, and age. */
function WorkspaceDescription({ workspace }: { workspace: ConductorWorkspaceSummary }) {
  const tabs = workspace.tabs.length;
  return (
    <>
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

function describeSession(session: AgentSessionSummary): string {
  return [
    session.preview !== session.title ? session.preview : null,
    `${session.messageCount} ${session.messageCount === 1 ? "message" : "messages"}`,
    formatRelativeTimeLabel(session.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ImportConversationList({
  projectRef,
  projectPicker,
}: {
  projectRef: ScopedProjectRef;
  projectPicker: ReactNode;
}) {
  const { environmentId, projectId } = projectRef;
  const navigate = useNavigate();
  const project = useProject(projectRef);
  const listing = useEnvironmentQuery(agentSessionList({ environmentId, input: { projectId } }));
  const importSession = useAtomCommand(agentSessionImport, { reportFailure: false });
  const conductorListing = useEnvironmentQuery(
    conductorWorkspaceList({ environmentId, input: { projectId } }),
  );
  const importWorkspace = useAtomCommand(conductorWorkspaceImport, { reportFailure: false });
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [chosenSource, setSource] = useState<ImportSource | null>(null);

  const openThread = (threadId: ThreadId) => {
    closeImportConversationDialog();
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
  };

  const choose = async (session: AgentSessionSummary) => {
    if (pendingKey !== null) return;
    if (session.threadId !== null) {
      openThread(session.threadId);
      return;
    }
    setPendingKey(sessionKey(session));
    const result = await importSession({
      environmentId,
      input: {
        projectId,
        ...(project ? { expectedWorkspaceRoot: project.workspaceRoot } : {}),
        session: {
          providerInstanceId: session.providerInstanceId,
          providerSessionId: session.providerSessionId,
        },
      },
    });
    if (result._tag === "Success") {
      const threadId = result.value.threadIds?.[0];
      listing.refresh();
      if (threadId) {
        // The route treats a thread the client has not heard of yet as missing.
        await waitForThreadShell(scopeThreadRef(environmentId, threadId)).catch(() => null);
        setPendingKey(null);
        openThread(threadId);
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

  const chooseWorkspace = async (workspace: ConductorWorkspaceSummary) => {
    if (pendingKey !== null) return;
    if (workspace.threadId !== null) {
      openThread(workspace.threadId);
      return;
    }
    setPendingKey(`conductor:${workspace.workspaceId}`);
    const result = await importWorkspace({
      environmentId,
      input: { projectId, workspaceId: workspace.workspaceId },
    });
    if (result._tag === "Success" && result.value.threadIds[0] !== undefined) {
      const threadId = result.value.threadIds[0];
      conductorListing.refresh();
      await waitForThreadShell(scopeThreadRef(environmentId, threadId)).catch(() => null);
      setPendingKey(null);
      openThread(threadId);
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

  // Conductor leads while its listing loads; without Conductor on this machine, show everything.
  const conductorMissing = conductorListing.data?.available === false;
  const source: ImportSource =
    chosenSource === null || (chosenSource === "conductor" && conductorMissing)
      ? conductorMissing
        ? "all"
        : "conductor"
      : chosenSource;
  const sessions = listing.data?.sessions.filter(
    (session) => source === "all" || session.provider === source,
  );
  const workspaces =
    source === "all" || source === "conductor" ? (conductorListing.data?.workspaces ?? []) : [];
  const rows: ReadonlyArray<ImportRow> = [
    ...(source === "conductor" ? [] : (sessions ?? [])).map((session): ImportRow => ({
      kind: "session",
      session,
      updatedAt: session.updatedAt,
    })),
    ...workspaces.map((workspace): ImportRow => ({
      kind: "workspace",
      workspace,
      updatedAt: workspace.updatedAt,
    })),
  ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const loading =
    source === "conductor" ? conductorListing.data === undefined : sessions === undefined;
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
          count={loading ? undefined : rows.length}
          options={sourceOptions}
        />
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {(source === "conductor" ? conductorListing.error : listing.error) ?? (
            <Spinner size="md" tone="muted" />
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {source === "conductor"
            ? "No active Conductor workspaces found for this repository."
            : source === "all"
              ? "Nothing to import for this project."
              : `No ${SOURCE_LABEL[source]} conversations found for this folder.`}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto">
          <DiscoveryList>
            {rows.map((row) => {
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
                    description={describeSession(session)}
                    disabled={pendingKey !== null}
                    aria-label={`${session.threadId ? "Open" : "Import"} ${session.title}`}
                    onClick={() => void choose(session)}
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
                  description={<WorkspaceDescription workspace={workspace} />}
                  disabled={pendingKey !== null}
                  aria-label={`${workspace.threadId ? "Open" : "Import"} ${workspace.title}`}
                  onClick={() => void chooseWorkspace(workspace)}
                  action={rowAction(pendingKey === key, workspace.threadId !== null)}
                />
              );
            })}
          </DiscoveryList>
          {listing.data?.truncated && source !== "conductor" ? (
            <p className="mt-2 text-muted-foreground text-xs">
              Showing the newest 50 conversations.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
