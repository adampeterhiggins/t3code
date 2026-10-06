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

const CONDUCTOR_AGENT: Record<ConductorAgent, { driver: ProviderDriverKind; label: string }> = {
  claude: { driver: ProviderDriverKind.make("claudeAgent"), label: "Claude Code" },
  codex: { driver: ProviderDriverKind.make("codex"), label: "Codex" },
  cursor: { driver: ProviderDriverKind.make("cursor"), label: "Cursor" },
};

function describeWorkspace(workspace: ConductorWorkspaceSummary): string {
  return [
    workspace.branch,
    workspace.tabs.length === 1 ? workspace.tabs[0]!.title : `${workspace.tabs.length} tabs`,
    formatRelativeTimeLabel(workspace.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
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

  const sessions = listing.data?.sessions ?? null;
  const workspaces = conductorListing.data?.workspaces ?? [];

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
            {project?.title ?? "this project"}, and its active Conductor workspaces. An imported
            conversation continues the same session.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {sessions === null ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
              {listing.error ?? <Spinner size="md" tone="muted" />}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-muted-foreground text-sm">
              No Claude Code or Codex conversations found for this folder.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <DiscoveryList>
                {sessions.map((session) => {
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
                      action={
                        pendingKey === key ? (
                          <Spinner size="xs" />
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {session.threadId ? "Open" : "Import"}
                          </span>
                        )
                      }
                    />
                  );
                })}
              </DiscoveryList>
              {listing.data?.truncated ? (
                <p className="mt-2 text-muted-foreground text-xs">Showing the newest 50.</p>
              ) : null}
            </div>
          )}
          {workspaces.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              <h3 className="font-medium text-muted-foreground text-xs">Conductor workspaces</h3>
              <div className="max-h-72 overflow-y-auto">
                <DiscoveryList>
                  {workspaces.map((workspace) => {
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
                        title={workspace.name}
                        description={describeWorkspace(workspace)}
                        disabled={pendingKey !== null}
                        aria-label={`${workspace.threadId ? "Open" : "Import"} ${workspace.name}`}
                        onClick={() => void chooseWorkspace(workspace)}
                        action={
                          pendingKey === key ? (
                            <Spinner size="xs" />
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {workspace.threadId ? "Open" : "Import"}
                            </span>
                          )
                        }
                      />
                    );
                  })}
                </DiscoveryList>
              </div>
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
