import {
  MessageDraftId,
  ThreadId,
  type MessageDraft,
  type ChatFileAttachment,
  type ChatImageAttachment,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attachmentContextRecord } from "../../lib/composerContextRecords";
import { messageDraftComposerRecords, openMessageDraftInComposer } from "./messageDraftComposer";

const image: ChatImageAttachment = {
  type: "image",
  id: "thread-1-image",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 10,
};
const file: ChatFileAttachment = {
  type: "file",
  id: "thread-1-file",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 4,
};

describe("messageDraftComposerRecords", () => {
  it("keeps the draft's own attachment records", () => {
    const record = attachmentContextRecord({ attachment: image, attachmentId: image.id });
    expect(
      messageDraftComposerRecords({
        attachments: [image],
        context: { version: 1, records: [record] },
      }),
    ).toEqual([record]);
  });

  it("adds records for attachments saved without one, so opening keeps them", () => {
    const records = messageDraftComposerRecords({ attachments: [image, file] });
    expect(
      records.map((record) => [record.kind, "attachmentId" in record && record.attachmentId]),
    ).toEqual([
      ["image", image.id],
      ["file", file.id],
    ]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function draftOpening() {
  const draft = {
    id: MessageDraftId.make("draft"),
    threadId: ThreadId.make("thread"),
    text: "saved message",
    attachments: [],
    origin: "web" as const,
    createdAt: "2026-10-27T12:00:00.000Z",
  };
  const composer = { targetKey: "thread", hasContent: false, hasPrompt: false };
  const loaded: MessageDraft[] = [];
  const returned: MessageDraft[] = [];
  const input = {
    targetKey: "thread",
    take: async () => draft,
    putBack: async (value: MessageDraft) => {
      returned.push(value);
    },
    readComposer: () => composer,
    saveCurrent: async () => true,
    waitForRender: async () => {},
    load: (value: MessageDraft) => {
      loaded.push(value);
    },
  };
  return { draft, composer, loaded, returned, input };
}

describe("openMessageDraftInComposer", () => {
  it("returns the taken draft when the user switches composers during the request", async () => {
    const state = draftOpening();
    const take = deferred<MessageDraft | null>();
    const opening = openMessageDraftInComposer({ ...state.input, take: () => take.promise });
    state.composer.targetKey = "another-thread";
    take.resolve(state.draft);
    await opening;
    expect(state.returned).toEqual([state.draft]);
    expect(state.loaded).toEqual([]);
  });

  it.each(["save failed", "prompt remains"])("keeps existing content when %s", async (reason) => {
    const state = draftOpening();
    state.composer.hasContent = true;
    state.composer.hasPrompt = reason === "prompt remains";
    await openMessageDraftInComposer({
      ...state.input,
      saveCurrent: async () => reason !== "save failed",
    });
    expect(state.returned).toEqual([state.draft]);
    expect(state.loaded).toEqual([]);
  });

  it("waits for the saved composer's render before loading the taken draft", async () => {
    const state = draftOpening();
    state.composer.hasContent = true;
    const rendered = deferred<void>();
    const waiting = deferred<void>();
    const opening = openMessageDraftInComposer({
      ...state.input,
      saveCurrent: async () => {
        state.composer.hasContent = false;
        return true;
      },
      waitForRender: () => {
        waiting.resolve();
        return rendered.promise;
      },
    });
    await waiting.promise;
    expect(state.loaded).toEqual([]);
    rendered.resolve();
    await opening;
    expect(state.loaded).toEqual([state.draft]);
    expect(state.returned).toEqual([]);
  });

  it("leaves the composer alone when another device already took the draft", async () => {
    const state = draftOpening();
    await openMessageDraftInComposer({ ...state.input, take: async () => null });
    expect(state.loaded).toEqual([]);
    expect(state.returned).toEqual([]);
  });
});
