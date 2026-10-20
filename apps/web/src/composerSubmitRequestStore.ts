import { create } from "zustand";

import { composerTargetKey, type ComposerThreadTarget } from "./composerDraftStore";

/** Send what the draft holds, or keep it as a draft on the thread to send later. */
export type ComposerSubmitIntent = "send" | "save-draft";

interface ComposerSubmitRequestState {
  /** Composer target keys whose draft should be handled as soon as that composer can. */
  readonly pending: ReadonlyMap<string, ComposerSubmitIntent>;
  readonly request: (target: ComposerThreadTarget, intent?: ComposerSubmitIntent) => void;
  /** Claims a request once; null when there was none or another composer took it. */
  readonly take: (key: string) => ComposerSubmitIntent | null;
}

/**
 * One-shot asks, from outside a composer, to send what its draft holds. Writing to a draft and
 * pressing send are both the reader's to do from the composer; this lets a surface beside it,
 * such as a pull request's "Send to agent", press send for them through the composer's own path,
 * so queueing, validation and attachments behave exactly as they would for Enter. Saving as a
 * draft goes the same way, so it uploads and records context exactly as the composer's own save.
 */
export const useComposerSubmitRequestStore = create<ComposerSubmitRequestState>((set, get) => ({
  pending: new Map(),
  request: (target, intent = "send") =>
    set((state) => ({
      pending: new Map(state.pending).set(composerTargetKey(target), intent),
    })),
  take: (key) => {
    const intent = get().pending.get(key) ?? null;
    if (intent === null) return null;
    set((state) => {
      const pending = new Map(state.pending);
      pending.delete(key);
      return { pending };
    });
    return intent;
  },
}));
