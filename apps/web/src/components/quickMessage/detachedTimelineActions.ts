import type { ScopedThreadRef } from "@t3tools/contracts";

import { isDetachedChatWindow } from "./quickMessageWindow";

/**
 * Terminal, diff, file-viewer, and project-script actions belong to the main
 * window. The floating chat has nowhere to show them, so invoking one must not
 * open a hidden panel or run a script.
 */
function floatingOmitsShellAndPanels(): boolean {
  return isDetachedChatWindow;
}

export function runTimelineShellCommand(command: string, run: (command: string) => void): void {
  if (floatingOmitsShellAndPanels()) return;
  run(command);
}

export function timelineWorktreeTerminalOpener<ThreadRef extends ScopedThreadRef>(input: {
  readonly threadRef: ThreadRef | null;
  readonly ensureTerminal: (
    threadRef: ThreadRef,
    terminalId: string,
    options: { readonly open: true; readonly active: true },
  ) => void;
}): ((terminalId: string) => void) | null {
  if (floatingOmitsShellAndPanels() || input.threadRef === null) return null;
  const threadRef = input.threadRef;
  return (terminalId) => {
    input.ensureTerminal(threadRef, terminalId, { open: true, active: true });
  };
}

export function openTimelineTurnDiff(open: () => void): void {
  if (floatingOmitsShellAndPanels()) return;
  open();
}

export function openTimelineFileAttachment(open: () => void): void {
  if (floatingOmitsShellAndPanels()) return;
  open();
}

export function openTimelineWorkspaceFile(open: () => void): void {
  if (floatingOmitsShellAndPanels()) return;
  open();
}
