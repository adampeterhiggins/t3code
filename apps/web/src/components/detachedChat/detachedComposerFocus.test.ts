import { describe, expect, it, vi } from "vite-plus/test";

import {
  cancelPendingDetachedComposerFocus,
  deliverPendingDetachedComposerFocus,
  detachedComposerWindowCanFocus,
  noteDetachedComposerShow,
  resetDetachedComposerFocusForTests,
} from "./detachedComposerFocus";

function windowState(input: { readonly visible: boolean; readonly focused: boolean }) {
  return {
    visibilityState: input.visible ? ("visible" as const) : ("hidden" as const),
    hasFocus: () => input.focused,
  };
}

describe("detached composer focus", () => {
  it("focuses the first connected editor after a show that found none", () => {
    resetDetachedComposerFocusForTests();
    const focus = vi.fn();
    expect(detachedComposerWindowCanFocus(windowState({ visible: true, focused: true }))).toBe(
      true,
    );
    expect(noteDetachedComposerShow({ eligible: true, focused: false })).toBe("waiting");
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: false, focus })).toBe(
      false,
    );
    expect(focus).not.toHaveBeenCalled();
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: true, focus })).toBe(
      true,
    );
    expect(focus).toHaveBeenCalledOnce();
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: true, focus })).toBe(
      false,
    );
    expect(focus).toHaveBeenCalledOnce();
  });

  it("does not arm a show the window cannot take, and a later editor does not focus", () => {
    resetDetachedComposerFocusForTests();
    const focus = vi.fn();
    expect(detachedComposerWindowCanFocus(windowState({ visible: true, focused: false }))).toBe(
      false,
    );
    expect(detachedComposerWindowCanFocus(windowState({ visible: false, focused: true }))).toBe(
      false,
    );
    expect(noteDetachedComposerShow({ eligible: false, focused: false })).toBe("ignored");
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: true, focus })).toBe(
      false,
    );
    expect(focus).not.toHaveBeenCalled();
  });

  it("drops a waiting show when the window is hidden before the editor commits", () => {
    resetDetachedComposerFocusForTests();
    const focus = vi.fn();
    noteDetachedComposerShow({ eligible: true, focused: false });
    expect(deliverPendingDetachedComposerFocus({ eligible: false, connected: true, focus })).toBe(
      false,
    );
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: true, focus })).toBe(
      false,
    );
    expect(focus).not.toHaveBeenCalled();
  });

  it("drops a waiting show on dismiss so the editor cannot focus or reveal the window", () => {
    resetDetachedComposerFocusForTests();
    const focus = vi.fn();
    noteDetachedComposerShow({ eligible: true, focused: false });
    cancelPendingDetachedComposerFocus();
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: true, focus })).toBe(
      false,
    );
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not wait again when the show focused the composer that was already mounted", () => {
    resetDetachedComposerFocusForTests();
    const focus = vi.fn();
    expect(noteDetachedComposerShow({ eligible: true, focused: true })).toBe("focused");
    expect(deliverPendingDetachedComposerFocus({ eligible: true, connected: true, focus })).toBe(
      false,
    );
    expect(focus).not.toHaveBeenCalled();
  });
});
