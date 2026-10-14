import type { StoreApi } from "zustand/vanilla";
import type { ComposerFileAttachment } from "./composerDraftStore";
import { composerAttachmentBytes } from "./composerAttachmentBytes";

type DraftState = {
  draftsByThreadKey: Record<string, { files: ComposerFileAttachment[] }>;
};

/** Observe all draft mutations, including moves, submission, and environment removal. */
export function persistComposerDraftFiles<State extends DraftState>(
  store: StoreApi<State>,
  storage = composerAttachmentBytes,
) {
  let pending = Promise.resolve();
  let previousFiles = new Map<string, File | null>();
  const restoring = new Set<string>();
  const enqueue = (operation: () => Promise<void>) => {
    pending = pending.then(operation).catch(() => {});
  };
  const filesNow = () =>
    Object.values(store.getState().draftsByThreadKey).flatMap((draft) => draft.files);

  // Read the current draft ids again at deletion time: hydration or a draft move
  // may have happened while the database was opening.
  enqueue(async () => {
    for (const id of await storage.keys()) {
      if (!filesNow().some((file) => file.id === id)) await storage.remove(id);
    }
  });

  const synchronize = () => {
    const files = filesNow();
    const currentFiles = new Map(files.map((file) => [file.id, file.file]));
    for (const id of previousFiles.keys()) {
      if (!currentFiles.has(id)) enqueue(() => storage.remove(id));
    }
    for (const attachment of files) {
      const file = attachment.file;
      if (file && previousFiles.get(attachment.id) !== file) {
        enqueue(() => storage.put(attachment.id, file));
      }
      if (!attachment.restoringBytes || restoring.has(attachment.id)) continue;
      restoring.add(attachment.id);
      enqueue(async () => {
        let restored: File | null = null;
        try {
          const bytes = await storage.get(attachment.id);
          if (bytes && bytes.size === attachment.sizeBytes) {
            restored = new File([bytes], attachment.name, { type: attachment.mimeType });
          }
        } catch {
          // Missing or unavailable local storage falls back to reattachment.
        }
        previousFiles.set(attachment.id, restored);
        store.setState((state) => ({
          ...state,
          draftsByThreadKey: Object.fromEntries(
            Object.entries(state.draftsByThreadKey).map(([key, draft]) => [
              key,
              draft.files.some((file) => file.id === attachment.id && file.restoringBytes)
                ? {
                    ...draft,
                    files: draft.files.map((file) =>
                      file.id === attachment.id && file.restoringBytes && file.file === null
                        ? { ...file, file: restored, restoringBytes: false }
                        : file,
                    ),
                  }
                : draft,
            ]),
          ),
        }));
        restoring.delete(attachment.id);
      });
    }
    previousFiles = currentFiles;
  };
  synchronize();
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.draftsByThreadKey === previous.draftsByThreadKey) return;
    const drafts = Object.entries(state.draftsByThreadKey);
    if (
      drafts.length !== Object.keys(previous.draftsByThreadKey).length ||
      drafts.some(([key, draft]) => draft.files !== previous.draftsByThreadKey[key]?.files)
    ) {
      synchronize();
    }
  });
  return {
    unsubscribe,
    // Includes work queued by restoration itself, without time-based polling.
    settled: async () => {
      let snapshot;
      do {
        snapshot = pending;
        await snapshot;
      } while (snapshot !== pending);
    },
  };
}
