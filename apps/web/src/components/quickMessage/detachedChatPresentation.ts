import type { ClientSettings, DesktopQuickMessagePresentation } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { projectScriptIdFromCommand } from "../../projectScripts";
import { isDetachedChatWindow } from "./quickMessageWindow";

/**
 * The floating window is sized for a 52rem composer: 916px wide is that width
 * plus the compact frame's 3rem of padding and a little slack. Expanded is the
 * same column, tall enough for the timeline.
 */
export const DETACHED_CHAT_CONTENT_MAX_WIDTH = "52rem";

export type DetachedChatPresentation = DesktopQuickMessagePresentation;

/**
 * Send and navigation moments that change the floating window. Null leaves the
 * current presentation alone: a server follow-up stays expanded, and a new
 * draft that never opened stays where it was.
 */
export type DetachedPresentationMilestone =
  | "foreground-draft-turn-started"
  | "thread-created-without-message"
  | "draft-send-failed"
  | "background-draft"
  | "fanout"
  | "server-follow-up"
  | "existing-thread-opened"
  | "new-draft-navigated"
  | "new-draft-failed";

const BLOCKED_DETACHED_SHORTCUTS = new Set([
  "splitView.toggle",
  "splitView.focusOther",
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
  "rightPanel.toggle",
  "rightPanel.new",
  "rightPanel.toggleMaximized",
  "rightPanel.close",
  "diff.toggle",
  "preview.toggle",
  "preview.refresh",
  "preview.focusUrl",
  "preview.zoomIn",
  "preview.zoomOut",
  "preview.resetZoom",
]);

let presentation: DetachedChatPresentation = "compact";
const listeners = new Set<() => void>();

export function presentationForDetachedMilestone(
  milestone: DetachedPresentationMilestone,
): DetachedChatPresentation | null {
  switch (milestone) {
    case "foreground-draft-turn-started":
    case "thread-created-without-message":
    case "existing-thread-opened":
      return "expanded";
    case "draft-send-failed":
    case "background-draft":
    case "fanout":
    case "new-draft-navigated":
      return "compact";
    case "server-follow-up":
    case "new-draft-failed":
      return null;
  }
}

/**
 * Split, terminal, browser, device, and project-script shortcuts have no
 * surface in this window. Matching still uses the real focus context; this
 * only decides whether the floating window consumes the chord.
 */
export function detachedChatShortcutRuns(command: string): boolean {
  if (!isDetachedChatWindow) return true;
  if (BLOCKED_DETACHED_SHORTCUTS.has(command)) return false;
  return projectScriptIdFromCommand(command) === null;
}

export function floatingSplitPartnerInput<T>(input: {
  readonly detached: boolean;
  readonly splitHidden: boolean;
  readonly serverThreadRef: T | null;
}): T | null {
  if (input.detached || input.splitHidden || input.serverThreadRef === null) return null;
  return input.serverThreadRef;
}

/** A thread route is `/$environmentId/$threadId`. Settings and drafts are not. */
export function detachedOpenExpandsThread(href: string): boolean {
  const withoutHash = href.includes("#") ? (href.split("#").pop() ?? "") : href;
  const path = withoutHash.split("?")[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) return false;
  const [head] = segments;
  return (
    head !== "draft" &&
    head !== "settings" &&
    head !== "projects" &&
    head !== "pair" &&
    head !== "welcome" &&
    head !== "quick-message"
  );
}

export function compactBackdropShouldDismiss(event: {
  readonly target: unknown;
  readonly currentTarget: unknown;
}): boolean {
  return event.target !== null && event.target === event.currentTarget;
}

export function readDetachedChatPresentation(): DetachedChatPresentation {
  return presentation;
}

function emitPresentation(): void {
  for (const listener of listeners) listener();
}

export function subscribeDetachedChatPresentation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publishDetachedChatPresentation(
  next: DetachedChatPresentation,
  notifyShell: boolean,
): void {
  if (!isDetachedChatWindow) return;
  if (presentation !== next) {
    presentation = next;
    emitPresentation();
  }
  if (!notifyShell || typeof window === "undefined") return;
  const setPresentation = window.desktopBridge?.quickMessage?.setPresentation;
  if (!setPresentation) return;
  void setPresentation(next).catch(() => undefined);
}

/** No-ops unless this window was constructed as the isolated floating chat. */
export function requestDetachedComposerExpanded(): void {
  publishDetachedChatPresentation("expanded", true);
}

/** No-ops unless this window was constructed as the isolated floating chat. */
export function requestDetachedComposerCompact(): void {
  publishDetachedChatPresentation("compact", true);
}

/**
 * Match a presentation the shell already applied, such as the one it kept
 * across hide and show. Calling setPresentation again would fight that.
 */
export function adoptDetachedChatPresentation(next: DetachedChatPresentation): void {
  publishDetachedChatPresentation(next, false);
}

export function applyDetachedPresentationMilestone(milestone: DetachedPresentationMilestone): void {
  const next = presentationForDetachedMilestone(milestone);
  if (next === "expanded") requestDetachedComposerExpanded();
  else if (next === "compact") requestDetachedComposerCompact();
}

/** Compact after a new draft actually opened. A null result leaves the window alone. */
export function noteDetachedNewDraftOpened(opened: unknown): void {
  if (opened === null || opened === undefined) return;
  applyDetachedPresentationMilestone("new-draft-navigated");
}

export function dismissDetachedChat(): void {
  if (!isDetachedChatWindow) return;
  const dismiss = window.desktopBridge?.quickMessage?.dismiss;
  if (!dismiss) return;
  void dismiss().catch(() => undefined);
}

export const DETACHED_COMPOSER_INPUT_SELECTOR = '[data-testid="composer-editor"]';

/** Focus the composer that is already on screen. Does not change its text. */
export function focusDetachedComposerInput(root: ParentNode): boolean {
  const editor = root.querySelector<HTMLElement>(DETACHED_COMPOSER_INPUT_SELECTOR);
  if (!editor) return false;
  editor.focus();
  return true;
}

export function handleDetachedChatShow(
  event: {
    readonly clientSettings: ClientSettings;
    readonly presentation?: DetachedChatPresentation;
  },
  actions: {
    readonly adoptSettings: (settings: ClientSettings) => void;
    readonly focusInput: () => void;
    readonly adoptPresentation: (presentation: DetachedChatPresentation) => void;
  },
): void {
  actions.adoptSettings(event.clientSettings);
  actions.adoptPresentation(event.presentation ?? "compact");
  actions.focusInput();
}

function subscribeIdle(): () => void {
  return () => undefined;
}

function subscribeActivePresentation(listener: () => void): () => void {
  return isDetachedChatWindow ? subscribeDetachedChatPresentation(listener) : subscribeIdle();
}

function readActivePresentation(): DetachedChatPresentation | null {
  return isDetachedChatWindow ? presentation : null;
}

export function useDetachedChatPresentation(): DetachedChatPresentation | null {
  return useSyncExternalStore(
    subscribeActivePresentation,
    readActivePresentation,
    readActivePresentation,
  );
}

/** Test-only. The store is process-wide because the window has one presentation. */
export function resetDetachedChatPresentationForTests(): void {
  presentation = "compact";
  listeners.clear();
}
