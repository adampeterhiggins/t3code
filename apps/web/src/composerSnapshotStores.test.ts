import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { repositoryContextRecord } from "@t3tools/shared/integrationContextRecords";
import {
  decodeComposerContextFragment,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import { importComposerSnapshotRecord } from "./lib/composerSnapshotImport";
import { describe, expect, it } from "vite-plus/test";
import { createJSONStorage } from "zustand/middleware";

import { createMemoryStorage } from "./lib/storage";
import { toComposerContextId } from "./lib/composerContextReferences";
import { useCheckoutContextStore } from "./checkoutContextStore";
import { useRepositoryContextStore } from "./repositoryContextStore";
import { useIssueContextStore } from "./issueContextStore";
import { useThreadTabContextStore } from "./threadTabContextStore";

const threadId = ThreadId.make("draft-thread");
const repository = repositoryContextRecord({
  nameWithOwner: "focaldata/orchestra",
  remoteUrl: "https://github.com/focaldata/orchestra",
});
const issue = {
  version: 1 as const,
  kind: "github-issue" as const,
  contextId: toComposerContextId("issue_42"),
  label: "acme/app#42",
  repository: "acme/app",
  number: 42,
  title: "Fix login",
  url: "https://github.com/acme/app/issues/42",
  state: "open" as const,
  markdown: "The login button does nothing.",
};
const tab = {
  version: 1 as const,
  kind: "thread-tab" as const,
  contextId: toComposerContextId("tab_summary"),
  label: "Earlier investigation",
  threadId: ThreadId.make("other-thread"),
  title: "Earlier investigation",
  summary: "The failure starts after reconnecting.",
};

const cases = [
  {
    name: "repository",
    store: useRepositoryContextStore,
    reset: () => useRepositoryContextStore.setState({ recordsByThreadId: {} }),
    attach: () => useRepositoryContextStore.getState().upsert(threadId, repository),
    record: repository,
    conflicting: { ...repository, directoryName: "other-checkout" },
  },
  {
    name: "issue",
    store: useIssueContextStore,
    reset: () => useIssueContextStore.setState({ recordsByThreadId: {} }),
    attach: () => useIssueContextStore.getState().upsert(threadId, issue),
    record: issue,
    conflicting: { ...issue, markdown: "Updated investigation." },
  },
  {
    name: "tab summary",
    store: useThreadTabContextStore,
    reset: () => useThreadTabContextStore.setState({ recordsByThreadId: {} }),
    attach: () => useThreadTabContextStore.getState().upsert(threadId, tab),
    record: tab,
    conflicting: { ...tab, summary: "Updated investigation." },
  },
];

describe.each(cases)("$name draft snapshots", ({ store, reset, attach, record, conflicting }) => {
  it("imports a copied snapshot into another composer without overwriting a conflicting chip", () => {
    reset();
    const fragment = decodeComposerContextFragment(
      encodeComposerContextFragment({
        version: 1,
        source: { environmentId: EnvironmentId.make("source") },
        records: [record],
      }),
    );
    expect(fragment?.records).toEqual([record]);
    const destination = ThreadId.make("destination");
    const contextId = importComposerSnapshotRecord(destination, record, false);
    const freshId = importComposerSnapshotRecord(destination, conflicting, true);
    expect(contextId).toBe(record.contextId);
    expect(freshId).not.toBe(contextId);
    expect(store.getState().recordsByThreadId[destination]).toEqual([
      record,
      { ...conflicting, contextId: freshId },
    ]);
  });
  it("restores the chip payload after a reload and keeps cleared drafts cleared", async () => {
    const storage = createMemoryStorage();
    store.persist.setOptions({ storage: createJSONStorage(() => storage) });
    reset();
    attach();
    const key = store.persist.getOptions().name!;
    const saved = await storage.getItem(key);
    expect(saved).not.toBeNull();

    // Rebuild runtime state from the serialized snapshot, as a new app instance does.
    reset();
    storage.setItem(key, saved!);
    await store.persist.rehydrate();
    expect(store.getState().recordsByThreadId[threadId]).toEqual([record]);
    attach();
    expect(store.getState().recordsByThreadId[threadId]).toEqual([record]);

    store.getState().clear(threadId);
    await store.persist.rehydrate();
    expect(store.getState().recordsByThreadId[threadId]).toBeUndefined();
  });
});

describe("checkout draft snapshots", () => {
  it("imports a copied checkout into another composer without overwriting a conflicting chip", () => {
    useCheckoutContextStore.setState({ recordsByThreadId: {} });
    const checkout = {
      version: 1 as const,
      kind: "checkout" as const,
      contextId: toComposerContextId("checkout_main"),
      label: "t3code",
      environmentId: EnvironmentId.make("source"),
      path: "/Users/me/t3code",
      branch: "main",
      headSha: "abc123",
      changedFiles: 0,
      ahead: 0,
      access: "read" as const,
    };
    const destination = ThreadId.make("destination");
    const contextId = importComposerSnapshotRecord(destination, checkout, false);
    const conflicting = { ...checkout, branch: "feature" };
    const freshId = importComposerSnapshotRecord(destination, conflicting, true);
    expect(contextId).toBe(checkout.contextId);
    expect(useCheckoutContextStore.getState().recordsByThreadId[destination]).toEqual([
      checkout,
      { ...conflicting, contextId: freshId },
    ]);
  });
});
