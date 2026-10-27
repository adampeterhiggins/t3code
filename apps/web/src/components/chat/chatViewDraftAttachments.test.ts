import { expect, it, vi } from "vite-plus/test";
import {
  CheckoutContextRecord,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  RepositoryContextRecord,
  ThreadId,
  ThreadTabContextRecord,
  UnreadLinkContextRecord,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useCheckoutContextStore } from "../../checkoutContextStore";
import { useIssueContextStore } from "../../issueContextStore";
import { useRepositoryContextStore } from "../../repositoryContextStore";
import { useThreadTabContextStore } from "../../threadTabContextStore";
import {
  copyChatViewDraftAttachments,
  restoreMessageAttachments,
} from "./chatViewDraftAttachments";

function setup() {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  useCheckoutContextStore.setState({ recordsByThreadId: {} });
  useIssueContextStore.setState({ recordsByThreadId: {} });
  useRepositoryContextStore.setState({ recordsByThreadId: {} });
  useThreadTabContextStore.setState({ recordsByThreadId: {} });
  const environmentId = EnvironmentId.make("attachment-copy");
  return {
    source: scopeThreadRef(environmentId, ThreadId.make("source")),
    destination: scopeThreadRef(environmentId, ThreadId.make("destination")),
    store: useComposerDraftStore.getState(),
  };
}

it("restores mixed downloaded attachments in order without deduplicating equal files", () => {
  const { destination, store } = setup();
  using createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:restored");
  const image = new File(["image"], "same.png", { type: "image/png" });
  const file = new File(["text"], "readme.txt", { type: "text/plain" });
  restoreMessageAttachments(
    destination,
    {
      id: MessageId.make("message"),
      role: "user",
      runId: null,
      text: "retry",
      streaming: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      attachments: [
        { type: "image", id: "i1", name: image.name, mimeType: image.type, sizeBytes: image.size },
        { type: "file", id: "f1", name: file.name, mimeType: file.type, sizeBytes: file.size },
        { type: "image", id: "i2", name: image.name, mimeType: image.type, sizeBytes: image.size },
      ],
    },
    [image, file, image],
  );
  const restored = store.getComposerDraft(destination);
  expect(restored?.images.map((entry) => entry.file)).toEqual([image, image]);
  expect(restored?.files.map((entry) => entry.file)).toEqual([file]);
  expect(new Set(restored?.images.map((entry) => entry.id)).size).toBe(2);
  expect(createUrl).toHaveBeenCalledTimes(2);
});

it("copies attachments and side context while retaining source draft and independent image previews", () => {
  const { source, destination, store } = setup();
  using createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:destination");
  store.setPrompt(source, "source text");
  store.setPrompt(destination, "destination text");
  const image = {
    type: "image" as const,
    id: "image",
    name: "image.png",
    mimeType: "image/png",
    sizeBytes: 1,
    file: new File(["i"], "image.png"),
    previewUrl: "blob:source",
  };
  const file = {
    type: "file" as const,
    id: "file",
    name: "file.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
    file: new File(["f"], "file.txt"),
  };
  const annotation = {
    id: "annotation",
    pageUrl: "https://example.com",
    pageTitle: "Page",
    comment: "Review",
    elements: [],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const review = {
    id: "review",
    sectionId: "file:a.ts",
    sectionTitle: "a.ts",
    filePath: "a.ts",
    startIndex: 0,
    endIndex: 0,
    rangeLabel: "L1",
    text: "Why?",
    diff: "const a = 1;",
  };
  store.addImages(source, [image]);
  store.addFiles(source, [file]);
  store.setPreviewAnnotations(source, [annotation]);
  store.setReviewComments(source, [review]);
  const sourceBefore = store.getComposerDraft(source);
  copyChatViewDraftAttachments(source.threadId, source, destination);
  const copied = store.getComposerDraft(destination);
  expect(copied?.images).toEqual([{ ...image, previewUrl: "blob:destination" }]);
  expect(copied?.files).toEqual([file]);
  expect(copied?.previewAnnotations).toEqual([annotation]);
  expect(copied?.reviewComments).toEqual([review]);
  expect(copied?.prompt).toContain("destination text");
  expect(copied?.prompt).not.toContain("source text");
  expect(store.getComposerDraft(source)).toEqual(sourceBefore);
  expect(createUrl).toHaveBeenCalledWith(image.file);
});

it("copies all integration snapshots with stable chip ids even when the composer draft is absent", () => {
  const { source, destination, store } = setup();
  const tab = ThreadTabContextRecord.make({
    version: 1,
    contextId: ComposerContextId.make("tab"),
    label: "Tab",
    kind: "thread-tab",
    threadId: "sibling",
    title: "Sibling",
    summary: "Summary",
  });
  const issue = UnreadLinkContextRecord.make({
    version: 1,
    contextId: ComposerContextId.make("link"),
    label: "Link",
    kind: "unread-link",
    url: "https://example.com",
    linkKind: "linear-issue",
    reason: "unreadable",
  });
  const repository = RepositoryContextRecord.make({
    version: 1,
    contextId: ComposerContextId.make("repo"),
    label: "Repo",
    kind: "repository",
    nameWithOwner: "owner/repo",
    remoteUrl: "https://github.com/owner/repo.git",
    directoryName: "repo",
  });
  const checkout = CheckoutContextRecord.make({
    version: 1,
    contextId: ComposerContextId.make("checkout"),
    label: "Checkout",
    kind: "checkout",
    environmentId: source.environmentId,
    path: "/repo",
    branch: "main",
    headSha: null,
    changedFiles: 0,
    ahead: 0,
    access: "read",
  });
  useThreadTabContextStore.getState().upsert(source.threadId, tab);
  useIssueContextStore.getState().upsert(source.threadId, issue);
  useRepositoryContextStore.getState().upsert(source.threadId, repository);
  useCheckoutContextStore.getState().upsert(source.threadId, checkout);
  copyChatViewDraftAttachments(source.threadId, source, destination);
  expect(useThreadTabContextStore.getState().recordsByThreadId[destination.threadId]).toEqual([
    tab,
  ]);
  expect(useIssueContextStore.getState().recordsByThreadId[destination.threadId]).toEqual([issue]);
  expect(useRepositoryContextStore.getState().recordsByThreadId[destination.threadId]).toEqual([
    repository,
  ]);
  expect(useCheckoutContextStore.getState().recordsByThreadId[destination.threadId]).toEqual([
    checkout,
  ]);
  expect(store.getComposerDraft(destination)).toBeNull();
});
