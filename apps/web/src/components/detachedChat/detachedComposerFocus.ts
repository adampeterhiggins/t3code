/**
 * Show can arrive while the connecting notice is up and the composer does not
 * exist yet. The wait is one shot: the editor's create event takes it, and a
 * dismiss or a window that is no longer visible drops it instead of focusing later.
 */
let waitingForComposer = false;

export type DetachedComposerShowResult = "focused" | "waiting" | "ignored";

export function detachedComposerWindowCanFocus(target: {
  readonly visibilityState: DocumentVisibilityState;
  readonly hasFocus: () => boolean;
}): boolean {
  return target.visibilityState === "visible" && target.hasFocus();
}

export function noteDetachedComposerShow(input: {
  readonly eligible: boolean;
  readonly focused: boolean;
}): DetachedComposerShowResult {
  if (!input.eligible) {
    waitingForComposer = false;
    return "ignored";
  }
  if (input.focused) {
    waitingForComposer = false;
    return "focused";
  }
  waitingForComposer = true;
  return "waiting";
}

/** The editor view is in the document. A disconnected view keeps the wait. */
export function deliverPendingDetachedComposerFocus(input: {
  readonly eligible: boolean;
  readonly connected: boolean;
  readonly focus: () => void;
}): boolean {
  if (!waitingForComposer) return false;
  if (!input.eligible) {
    waitingForComposer = false;
    return false;
  }
  if (!input.connected) return false;
  input.focus();
  waitingForComposer = false;
  return true;
}

export function cancelPendingDetachedComposerFocus(): void {
  waitingForComposer = false;
}

export function resetDetachedComposerFocusForTests(): void {
  waitingForComposer = false;
}
