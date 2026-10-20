import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("./presentation", () => ({ environmentPresentations: {} }));
vi.mock("./query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("@t3tools/client-runtime/state/message-drafts", () => ({
  createMessageDraftEnvironmentAtoms: () => ({}),
  messageDraftsForThread: () => [],
}));

const { countMessageDraftsByThread, messageDraftFailureMessage } = await import("./messageDrafts");

describe("countMessageDraftsByThread", () => {
  it("counts drafts per thread across environments", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    const thread = ThreadId.make("thread-1");

    const counts = countMessageDraftsByThread([
      { environmentId: local, drafts: [{ threadId: thread }, { threadId: thread }] },
      { environmentId: remote, drafts: [{ threadId: thread }] },
      { environmentId: EnvironmentId.make("loading"), drafts: null },
    ]);

    expect([...counts]).toEqual([
      ["local:thread-1", 2],
      ["remote:thread-1", 1],
    ]);
  });

  it("returns the same empty map when nothing is drafted, so list rows stay equal", () => {
    expect(countMessageDraftsByThread([])).toBe(countMessageDraftsByThread([]));
  });
});

describe("messageDraftFailureMessage", () => {
  it("explains a draft another device already took", () => {
    expect(
      messageDraftFailureMessage({ _tag: "MessageDraftError", reason: "not-found", detail: "" }),
    ).toBe("This draft was already opened or sent on another device.");
  });

  it("falls back to the error's own message", () => {
    expect(messageDraftFailureMessage(new Error("Thread is gone"))).toBe("Thread is gone");
    expect(messageDraftFailureMessage(null)).toBe("Try again.");
  });
});
