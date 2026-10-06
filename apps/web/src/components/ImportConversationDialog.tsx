import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import { useState } from "react";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  agentSessionImport,
  agentSessionList,
  conductorWorkspaceImport,
  conductorWorkspaceList,
} from "~/state/agentSessions";
import { useProject, waitForThreadShell } from "~/state/entities";
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

const importConversationProjectAtom = Atom.make<ScopedProjectRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("import-conversation:project"),
);

/**
 * Opens the picker of Claude Code and Codex conversations recorded for a project's directory,
 * and of the project's active Conductor workspaces.
 */
export function openImportConversationDialog(projectRef: ScopedProjectRef): void {
  appAtomRegistry.set(importConversationProjectAtom, projectRef);
}

function closeImportConversationDialog() {
  appAtomRegistry.set(importConversationProjectAtom, null);
}

export function ImportConversationDialogHost() {
  const projectRef = useAtomValue(importConversationProjectAtom);
  if (projectRef === null) return null;
  return (
    <ImportConversationDialog
      key={`${projectRef.environmentId}:${projectRef.projectId}`}
      projectRef={projectRef}
    />
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

function describeWorkspace(workspace: ConductorWorkspaceSummary): string {
  const tabs = workspace.tabs.length;
  return [
    workspace.name,
    `${tabs} ${tabs === 1 ? "tab" : "tabs"}`,
    formatRelativeTimeLabel(workspace.updatedAt),
  ].join(" · ");
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

function ImportConversationDialog({ projectRef }: { projectRef: ScopedProjectRef }) {
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
  const [source, setSource] = useState<ImportSource>("all");

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

  const conductorAvailable = conductorListing.data?.available === true;
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
  const sourceOptions = SOURCES.filter(
    (option) => option !== "conductor" || conductorAvailable,
  ).map((option) => ({ value: option, label: SOURCE_LABEL[option] }));

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
            Claude Code and Codex conversations from the last 30 days in{" "}
            {project?.title ?? "this project"}
            {conductorAvailable ? ", and its active Conductor workspaces" : ""}. An imported
            conversation continues the same session.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="mb-2">
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
                      description={describeWorkspace(workspace)}
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
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
