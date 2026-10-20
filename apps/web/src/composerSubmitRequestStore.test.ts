import { describe, expect, it } from "vite-plus/test";

import { composerTargetKey, DraftId } from "./composerDraftStore";
import { useComposerSubmitRequestStore } from "./composerSubmitRequestStore";

describe("useComposerSubmitRequestStore", () => {
  it("hands a request's intent to the first composer that takes it", () => {
    const target = DraftId.make("submit-request:test");
    useComposerSubmitRequestStore.getState().request(target, "save-draft");
    const { take } = useComposerSubmitRequestStore.getState();
    expect(take(composerTargetKey(target))).toBe("save-draft");
    expect(take(composerTargetKey(target))).toBeNull();
  });

  it("sends unless asked otherwise, and the latest request wins", () => {
    const target = DraftId.make("submit-request:latest");
    const { request, take } = useComposerSubmitRequestStore.getState();
    request(target, "save-draft");
    request(target);
    expect(take(composerTargetKey(target))).toBe("send");
  });
});
