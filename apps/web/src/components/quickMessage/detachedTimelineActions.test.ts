import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const detached = vi.hoisted(() => ({ value: false }));

vi.mock("./quickMessageWindow", () => ({
  get isDetachedChatWindow() {
    return detached.value;
  },
}));

import {
  openTimelineFileAttachment,
  openTimelineTurnDiff,
  openTimelineWorkspaceFile,
  runTimelineShellCommand,
  timelineWorktreeTerminalOpener,
} from "./detachedTimelineActions";

describe("detached timeline actions", () => {
  afterEach(() => {
    detached.value = false;
  });

  it("runs shell, terminal, diff, and file actions in the main window", () => {
    const run = vi.fn();
    const ensureTerminal = vi.fn();
    const openDiff = vi.fn();
    const openAttachment = vi.fn();
    const openWorkspaceFile = vi.fn();
    const threadRef = { environmentId: "env", threadId: "thread" };

    runTimelineShellCommand("echo hi", run);
    const openTerminal = timelineWorktreeTerminalOpener({
      threadRef,
      ensureTerminal,
    });
    openTerminal?.("setup-terminal");
    openTimelineTurnDiff(openDiff);
    openTimelineFileAttachment(openAttachment);
    openTimelineWorkspaceFile(openWorkspaceFile);

    expect(run).toHaveBeenCalledExactlyOnceWith("echo hi");
    expect(ensureTerminal).toHaveBeenCalledExactlyOnceWith(threadRef, "setup-terminal", {
      open: true,
      active: true,
    });
    expect(openDiff).toHaveBeenCalledOnce();
    expect(openAttachment).toHaveBeenCalledOnce();
    expect(openWorkspaceFile).toHaveBeenCalledOnce();
  });

  it("does not open a terminal, diff, attachment, or script while floating", () => {
    detached.value = true;
    const run = vi.fn();
    const ensureTerminal = vi.fn();
    const openDiff = vi.fn();
    const openAttachment = vi.fn();
    const openWorkspaceFile = vi.fn();

    runTimelineShellCommand("echo hi", run);
    expect(
      timelineWorktreeTerminalOpener({
        threadRef: { environmentId: "env", threadId: "thread" },
        ensureTerminal,
      }),
    ).toBeNull();
    openTimelineTurnDiff(openDiff);
    openTimelineFileAttachment(openAttachment);
    openTimelineWorkspaceFile(openWorkspaceFile);

    expect(run).not.toHaveBeenCalled();
    expect(ensureTerminal).not.toHaveBeenCalled();
    expect(openDiff).not.toHaveBeenCalled();
    expect(openAttachment).not.toHaveBeenCalled();
    expect(openWorkspaceFile).not.toHaveBeenCalled();
  });

  it("offers no setup terminal when the setup thread is gone", () => {
    expect(
      timelineWorktreeTerminalOpener({
        threadRef: null,
        ensureTerminal: vi.fn(),
      }),
    ).toBeNull();
  });
});
