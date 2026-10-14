import { describe, expect, it, vi } from "vite-plus/test";
import { createStore } from "zustand/vanilla";
import type { ComposerFileAttachment } from "./composerDraftStore";
import { composerFileNeedsReattach } from "./composerDraftStore";
import { persistComposerDraftFiles } from "./composerDraftFilePersistence";

function attachment(id = "notes"): ComposerFileAttachment {
  const file = new File(["Draft notes"], "notes.txt", { type: "text/plain" });
  return { type: "file", id, name: file.name, mimeType: file.type, sizeBytes: file.size, file };
}

function memoryStorage() {
  const bytes = new Map<string, Blob>();
  return {
    bytes,
    put: vi.fn(async (id: string, file: File) => {
      bytes.set(id, file);
    }),
    get: vi.fn(async (id: string) => bytes.get(id) ?? null),
    remove: vi.fn(async (id: string) => {
      bytes.delete(id);
    }),
    keys: async () => [...bytes.keys()],
  };
}

function draftStore(files: ComposerFileAttachment[] = []) {
  return createStore(() => ({ draftsByThreadKey: { thread: { files, prompt: "Review these" } } }));
}

describe("draft file contents", () => {
  it("restores interrupted uploads after a reload with preview and upload bytes intact", async () => {
    const storage = memoryStorage();
    const original = attachment();
    const beforeReload = persistComposerDraftFiles(draftStore([original]), storage);
    await beforeReload.settled();
    beforeReload.unsubscribe();

    const store = draftStore([{ ...original, file: null, restoringBytes: true }]);
    const persistence = persistComposerDraftFiles(store, storage);
    expect(composerFileNeedsReattach(store.getState().draftsByThreadKey.thread.files[0]!)).toBe(
      false,
    );
    await persistence.settled();
    const restored = store.getState().draftsByThreadKey.thread.files[0]!;
    expect(await restored.file?.text()).toBe("Draft notes");
    expect(restored.file?.name).toBe(original.name);
    expect(restored.file?.type).toBe(original.mimeType);
    expect(restored.restoringBytes).toBe(false);
    expect(composerFileNeedsReattach(restored)).toBe(false);
    expect(storage.put).toHaveBeenCalledTimes(1);
    persistence.unsubscribe();
  });

  it.each(["missing", "unavailable", "wrong size"])(
    "falls back when contents are %s",
    async (failure) => {
      const storage = memoryStorage();
      if (failure === "unavailable") storage.get.mockRejectedValue(new Error("Storage denied"));
      if (failure === "wrong size") storage.bytes.set("notes", new Blob(["x"]));
      const store = draftStore([{ ...attachment(), file: null, restoringBytes: true }]);
      const persistence = persistComposerDraftFiles(store, storage);
      await persistence.settled();
      const restored = store.getState().draftsByThreadKey.thread.files[0]!;
      expect(restored.file).toBeNull();
      expect(composerFileNeedsReattach(restored)).toBe(true);
      persistence.unsubscribe();
    },
  );

  it("retains a server copy when local restoration fails", async () => {
    const store = draftStore([
      {
        ...attachment(),
        file: null,
        restoringBytes: true,
        uploadedAttachmentId: "uploaded",
      },
    ]);
    const persistence = persistComposerDraftFiles(store, memoryStorage());
    await persistence.settled();
    const restored = store.getState().draftsByThreadKey.thread.files[0]!;
    expect(restored.uploadedAttachmentId).toBe("uploaded");
    expect(composerFileNeedsReattach(restored)).toBe(false);
    persistence.unsubscribe();
  });

  it("deletes contents on removal even when the original write is still pending", async () => {
    const storage = memoryStorage();
    const store = draftStore([attachment()]);
    const persistence = persistComposerDraftFiles(store, storage);
    store.setState({ draftsByThreadKey: { thread: { files: [], prompt: "" } } });
    await persistence.settled();
    expect(storage.bytes.size).toBe(0);
    expect(storage.remove).toHaveBeenCalledWith("notes");
    persistence.unsubscribe();
  });

  it("restores to the destination when a draft moves during the read", async () => {
    const storage = memoryStorage();
    let resolveRead!: (bytes: Blob) => void;
    const read = new Promise<Blob>((resolve) => {
      resolveRead = resolve;
    });
    storage.get.mockImplementation(() => read);
    const original = attachment();
    const store = createStore(() => ({
      draftsByThreadKey: {
        source: {
          files: [{ ...original, file: null, restoringBytes: true } as ComposerFileAttachment],
        },
        destination: { files: [] as ComposerFileAttachment[] },
      },
    }));
    const persistence = persistComposerDraftFiles(store, storage);
    const sourceFiles = store.getState().draftsByThreadKey.source.files;
    store.setState({
      draftsByThreadKey: { source: { files: [] }, destination: { files: sourceFiles } },
    });
    resolveRead(original.file!);
    await persistence.settled();
    expect(store.getState().draftsByThreadKey.source.files).toEqual([]);
    expect(await store.getState().draftsByThreadKey.destination.files[0]?.file?.text()).toBe(
      "Draft notes",
    );
    expect(storage.remove).not.toHaveBeenCalled();
    persistence.unsubscribe();
  });

  it("never resurrects an attachment removed during restoration", async () => {
    const storage = memoryStorage();
    const original = attachment();
    storage.bytes.set(original.id, original.file!);
    const store = draftStore([{ ...original, file: null, restoringBytes: true }]);
    const persistence = persistComposerDraftFiles(store, storage);
    store.setState({ draftsByThreadKey: { thread: { files: [], prompt: "" } } });
    await persistence.settled();
    expect(store.getState().draftsByThreadKey.thread.files).toEqual([]);
    expect(storage.bytes.size).toBe(0);
    persistence.unsubscribe();
  });

  it("prunes abandoned contents and keeps current drafts without rewriting on prompt edits", async () => {
    const storage = memoryStorage();
    storage.bytes.set("orphan", new Blob(["old draft"]));
    const file = attachment();
    const store = draftStore([file]);
    const persistence = persistComposerDraftFiles(store, storage);
    await persistence.settled();
    store.setState({ draftsByThreadKey: { thread: { files: [file], prompt: "Another prompt" } } });
    await persistence.settled();
    expect([...storage.bytes.keys()]).toEqual([file.id]);
    expect(storage.put).toHaveBeenCalledTimes(1);
    persistence.unsubscribe();
  });

  it("leaves the current draft usable when storage is full", async () => {
    const storage = memoryStorage();
    storage.put.mockRejectedValue(new Error("QuotaExceededError"));
    const original = attachment();
    const store = draftStore([original]);
    const persistence = persistComposerDraftFiles(store, storage);
    await persistence.settled();
    expect(store.getState().draftsByThreadKey.thread.files[0]?.file).toBe(original.file);
    persistence.unsubscribe();
  });
});
