/**
 * Fork: carry a subagent's work into chat, from its agents list row or its agent tab.
 *
 * - Attach result pastes a finished agent's task and result into this chat's composer.
 * - Continue in chat opens a new chat tab whose draft carries the agent's task, outcome and
 *   latest tool calls as a chat-summary chip. It starts a fresh conversation; the agent's own
 *   provider session is not resumed.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  deriveSubagentToolCalls,
  subagentContinuationContext,
  subagentResultChatContext,
  type SubagentContextSubject,
} from "@t3tools/client-runtime/state/agent-list-view";
import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2Subagent,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

import type { ComposerHandleRef } from "~/composerHandleContext";
import { loadThreadProjection } from "~/state/entities";
import { readPreparedConnection } from "~/state/session";

import { toastManager } from "../ui/toast";
import { forkThreadTab } from "./ThreadTabs";

export function subagentContextSubject(
  subagent: Pick<OrchestrationV2Subagent, "status" | "prompt" | "result" | "progress">,
  title: string,
): SubagentContextSubject {
  const failed = subagent.status === "failed";
  return {
    title,
    status: subagent.status,
    prompt: subagent.prompt.trim() || null,
    result: failed ? null : subagent.result,
    error: failed ? (subagent.result ?? "The subagent failed.") : null,
    progress: subagent.progress ?? null,
  };
}

/** True when the agent has a settled result worth attaching. */
export function canAttachAgentResult(subject: SubagentContextSubject): boolean {
  return subagentResultChatContext(subject) !== null;
}

/** Adds a finished agent's findings to the chat composer; long results fold into an attachment. */
export function attachAgentResultToChat(
  composerRef: ComposerHandleRef | null,
  subject: SubagentContextSubject,
): void {
  const context = subagentResultChatContext(subject);
  if (context === null) return;
  const composer = composerRef?.current;
  if (composer?.pasteTextAtEnd(context)) return;
  toastManager.add({
    type: "error",
    title: "Unable to attach result",
    description: composer
      ? "The chat isn't ready to accept input right now."
      : "Open the parent chat and try again.",
  });
}

/**
 * Opens a new chat tab of `parentThread` seeded with the agent's work, and resolves once the
 * caller has navigated to it.
 */
export async function continueAgentInChat(input: {
  readonly environmentId: EnvironmentId;
  readonly parentThread: {
    readonly id: ThreadId;
    readonly title: string;
    readonly modelSelection: ModelSelection;
  };
  readonly subagent: OrchestrationV2Subagent;
  readonly title: string;
  /** The directory the agent's tool calls are shown relative to. */
  readonly workspaceRoot: string | null;
  readonly openTab: (tabRef: ScopedThreadRef) => unknown;
}): Promise<void> {
  const connection = readPreparedConnection(input.environmentId);
  if (!connection) {
    toastManager.add({ type: "error", title: "The environment is not connected." });
    return;
  }
  const childThreadId = input.subagent.childThreadId;
  const child =
    childThreadId === null
      ? null
      : await loadThreadProjection(scopeThreadRef(input.environmentId, childThreadId));
  const toolCalls =
    child === null || childThreadId === null
      ? []
      : deriveSubagentToolCalls(
          child.turnItems.filter((item) => item.threadId === childThreadId),
          input.workspaceRoot,
        );
  const context = subagentContinuationContext(
    subagentContextSubject(input.subagent, input.title),
    toolCalls,
  );
  if (context === null) {
    toastManager.add({
      type: "info",
      title: "Nothing to continue from yet",
      description: "This agent has no task, result, or tool calls to carry over.",
    });
    return;
  }
  try {
    const tabRef = await forkThreadTab(connection, {
      environmentId: input.environmentId,
      sourceThreadId: input.parentThread.id,
      sourceTitle: input.parentThread.title,
      modelSelection: input.parentThread.modelSelection,
      prompt: "",
      hasHistory: false,
      context: {
        producerId: `subagent:${input.subagent.id}`,
        title: input.title,
        summary: context,
      },
    });
    await input.openTab(tabRef);
  } catch (cause) {
    toastManager.add({
      type: "error",
      title: "Could not continue in a new tab",
      description: cause instanceof Error ? cause.message : undefined,
    });
  }
}
