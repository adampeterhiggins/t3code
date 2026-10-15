import { create } from "zustand";

import { composerTargetKey, type ComposerThreadTarget } from "./composerDraftStore";

interface ComposerSubmitRequestState {
  /** Composer target keys whose draft should be sent as soon as that composer can. */
  readonly pending: ReadonlySet<string>;
  readonly request: (target: ComposerThreadTarget) => void;
  /** Claims a request once; false when there was none or another composer took it. */
  readonly take: (key: string) => boolean;
}

/**
 * One-shot asks, from outside a composer, to send what its draft holds. Writing to a draft and
 * pressing send are both the reader's to do from the composer; this lets a surface beside it,
 * such as a pull request's "Send to agent", press send for them through the composer's own path,
 * so queueing, validation and attachments behave exactly as they would for Enter.
 */
export const useComposerSubmitRequestStore = create<ComposerSubmitRequestState>((set, get) => ({
  pending: new Set(),
  request: (target) =>
    set((state) => ({ pending: new Set(state.pending).add(composerTargetKey(target)) })),
  take: (key) => {
    if (!get().pending.has(key)) return false;
    set((state) => {
      const pending = new Set(state.pending);
      pending.delete(key);
      return { pending };
    });
    return true;
  },
}));
