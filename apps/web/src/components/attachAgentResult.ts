import { subagentResultChatContext } from "@t3tools/client-runtime/state/agentPanelView";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

import type { ComposerHandleRef } from "~/composerHandleContext";
import { toastManager } from "~/components/ui/toast";

/** Adds a finished agent's findings to the chat composer; long results fold into an attachment. */
export function attachAgentResultToChat(
  composerRef: ComposerHandleRef | null,
  agent: RuntimeSubagent,
): void {
  const context = subagentResultChatContext(agent);
  if (context === null) return;
  const composer = composerRef?.current;
  if (composer?.pasteTextAtEnd(context)) return;
  toastManager.add({
    type: "error",
    title: "Unable to attach result",
    description: composer
      ? "The chat isn't ready to accept input right now."
      : "Open this agent's chat and try again.",
  });
}
