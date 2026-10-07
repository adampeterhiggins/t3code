import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { toastManager } from "../components/ui/toast";
import { readProject, readThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Restarts a thread's agent session from the command palette, a tab's menu, or the sidebar.
 * Stopping the provider process keeps the conversation: the next message spawns a fresh one
 * that resumes it and reloads skills, plugins, and MCP servers. The fresh workspace scan
 * updates the composer's slash menu. Failures throw, so callers decide how to report them.
 */
export function useRestartAgentSession() {
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  return useCallback(
    async (threadRef: ScopedThreadRef) => {
      const thread = readThreadShell(threadRef);
      if (!thread) return;
      const { environmentId } = threadRef;
      if (thread.runtime !== null) {
        const stopped = await stopThreadSession({
          environmentId,
          input: { threadId: thread.id },
        });
        if (stopped._tag === "Failure") throw squashAtomCommandFailure(stopped);
      }
      // The server stops the process after accepting the command. A failed
      // stop shows in the thread.
      toastManager.add({
        type: "success",
        title: "Agent session will restart",
        description: "Your next message starts a fresh session.",
      });
      const project = readProject(scopeProjectRef(environmentId, thread.projectId));
      if (!project) return;
      const refreshed = await refreshProviders({
        environmentId,
        input: {
          instanceId: thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
          cwd: thread.worktreePath ?? project.workspaceRoot,
          fresh: true,
        },
      });
      if (refreshed._tag === "Failure") throw squashAtomCommandFailure(refreshed);
    },
    [refreshProviders, stopThreadSession],
  );
}

/** {@link useRestartAgentSession} for menus, which toast failures instead of throwing. */
export function useRestartAgentSessionWithToast() {
  const restart = useRestartAgentSession();
  return useCallback(
    async (threadRef: ScopedThreadRef) => {
      try {
        await restart(threadRef);
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: "Could not restart agent session",
          description: cause instanceof Error ? cause.message : undefined,
        });
      }
    },
    [restart],
  );
}
