import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { repositoryContextRecord } from "@t3tools/client-runtime/context-repositories";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "../../composerDraftStore";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { useRepositoryContextStore } from "../../repositoryContextStore";
import { attachRepository } from "./RepositoryAttachPicker";

const threadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
const input = {
  nameWithOwner: "t3tools/t3code",
  remoteUrl: "https://github.com/t3tools/t3code",
};

afterEach(() => {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  useRepositoryContextStore.setState({ recordsByThreadId: {} });
});

describe("attachRepository", () => {
  it("writes the repository chip onto the thread draft", () => {
    attachRepository(threadRef, input);

    const record = repositoryContextRecord(input);
    expect(useRepositoryContextStore.getState().recordsByThreadId[threadRef.threadId]).toEqual([
      record,
    ]);
    const reference = formatInlineContextReference({
      kind: "repository",
      contextId: record.contextId,
      label: record.label,
    });
    expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
      `${reference} `,
    );
  });
});
