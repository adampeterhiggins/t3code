import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import type { ResolvedComposerObjectLink } from "./useResolveComposerObjectLink";
import { useComposerObjectLinks, type ComposerUnreadLinkActions } from "./useComposerObjectLinks";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { pendingDraftWork } from "./pendingDraftWork";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./useResolveComposerObjectLink", () => ({
  useResolveComposerObjectLink: () => mocks.resolve,
}));

const url = "https://linear.app/acme/issue/ENG-1/fix-it";

function setup() {
  mocks.resolve.mockReset();
  const threadRef = {
    environmentId: EnvironmentId.make("composer-links-test"),
    threadId: ThreadId.make("composer-links-test-thread"),
  };
  const draftTarget: ComposerThreadTarget = threadRef;
  const key = "composer-links-test-draft";
  const draftKey = { current: key };
  const workKey = { current: key };
  const prompt = { current: url };
  const editor: RefObject<ComposerPromptEditorHandle | null> = { current: null };
  const actions: RefObject<ComposerUnreadLinkActions | null> = { current: null };
  const commit = vi.fn();
  const replacement = vi.fn((start: number, end: number, text: string) => {
    prompt.current = prompt.current.slice(0, start) + text + prompt.current.slice(end);
    return true;
  });
  let finish!: (result: ResolvedComposerObjectLink | "skipped") => void;
  mocks.resolve.mockReturnValue(
    new Promise<ResolvedComposerObjectLink | "skipped">((resolve) => {
      finish = resolve;
    }),
  );
  useComposerDraftStore.getState().setPrompt(draftTarget, url);
  const resolved: ResolvedComposerObjectLink = {
    reference: { kind: "linear-issue", contextId: "linear:ENG-1", label: "ENG-1" },
    commit,
  };
  function Harness() {
    const links = useComposerObjectLinks({
      routeThreadRef: threadRef,
      composerDraftTarget: draftTarget,
      composerDraftTargetKeyRef: draftKey,
      attachmentTargetKeyRef: workKey,
      promptRef: prompt,
      composerEditorRef: editor,
      composerFormRef: { current: null },
      unreadLinkActionsRef: actions,
      readComposerSnapshot: () => ({ expandedCursor: prompt.current.length }),
      applyPromptReplacement: replacement,
    });
    return (
      <>
        <button onClick={() => links.convertPastedObjectLinks(url, false, 0)}>Paste link</button>
        <button onClick={() => links.convertPastedObjectLinks(url, true, 0)}>Paste as text</button>
        <button onClick={() => links.convertTypedObjectLink(url, `${url} `, url.length + 1)}>
          Finish typing
        </button>
        <output aria-label="Loading links">{links.loadingObjectLinks.length}</output>
      </>
    );
  }
  return {
    Harness,
    editor,
    key,
    draftTarget,
    draftKey,
    workKey,
    prompt,
    actions,
    commit,
    replacement,
    finish: () => finish(resolved),
    resolveSkipped: () => finish("skipped"),
  };
}

describe("composer link conversion", () => {
  it("keeps paste-as-text through subsequent typing, but explicit paste retries", async () => {
    const test = setup();
    await using screen = await render(<test.Harness />);
    await screen.getByRole("button", { name: "Paste as text", exact: true }).click();
    await screen.getByRole("button", { name: "Finish typing" }).click();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Paste link", exact: true }).click();
    expect(pendingDraftWork.has(test.key)).toBe(true);
    test.resolveSkipped();
    await expect
      .element(screen.getByRole("status", { name: "Loading links" }))
      .toHaveTextContent("0");
    expect(pendingDraftWork.has(test.key)).toBe(false);
    expect(test.commit).not.toHaveBeenCalled();
  });

  it("updates the originating stored draft after switching threads", async () => {
    const test = setup();
    await using screen = await render(<test.Harness />);
    await screen.getByRole("button", { name: "Paste link", exact: true }).click();
    test.draftKey.current = "another-thread";
    test.workKey.current = "another-thread";
    test.prompt.current = "New thread text";
    test.finish();
    await vi.waitFor(() => expect(test.commit).toHaveBeenCalledOnce());
    const stored = useComposerDraftStore.getState().getComposerDraft(test.draftTarget)?.prompt;
    expect(stored).not.toContain(url);
    expect(stored).toContain("ENG-1");
    expect(test.prompt.current).toBe("New thread text");
    expect(test.replacement).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("status", { name: "Loading links" }))
      .toHaveTextContent("0");
  });

  it("drops a resolved link from a question answer that has closed", async () => {
    const test = setup();
    test.workKey.current = "question-answer";
    await using screen = await render(<test.Harness />);
    await screen.getByRole("button", { name: "Paste link", exact: true }).click();
    test.workKey.current = test.key;
    test.finish();
    await expect
      .element(screen.getByRole("status", { name: "Loading links" }))
      .toHaveTextContent("0");
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.replacement).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(test.draftTarget)?.prompt).toBe(url);
    expect(pendingDraftWork.has("question-answer")).toBe(false);
  });

  it("replaces a link at its current position and keeps the caret after text typed during loading", async () => {
    const test = setup();
    test.editor.current = {
      focus: vi.fn(),
      focusAt: vi.fn(),
      focusAtEnd: vi.fn(),
      readSelectionRange: () => ({ start: 0, end: 0 }),
      requestCitationComment: vi.fn(),
      readSnapshot: () => ({
        value: test.prompt.current,
        cursor: 0,
        expandedCursor: 0,
        contextIds: [],
      }),
      isCaretOnVisualEdge: () => false,
    };
    await using screen = await render(<test.Harness />);
    await screen.getByRole("button", { name: "Paste link", exact: true }).click();
    test.prompt.current = `before ${url} after`;
    test.finish();
    await vi.waitFor(() => expect(test.commit).toHaveBeenCalledOnce());
    expect(test.prompt.current).toMatch(/^before .* after$/u);
    expect(test.prompt.current).not.toContain(url);
    expect(test.replacement).toHaveBeenCalledWith(7, 8 + url.length, expect.any(String), {
      expandedCursorAfterReplace: test.prompt.current.length,
      focusEditorAfterReplace: false,
    });
    await expect
      .element(screen.getByRole("status", { name: "Loading links" }))
      .toHaveTextContent("0");
  });

  it("restores an unreadable chip to text without immediately converting it again", async () => {
    const test = setup();
    mocks.resolve.mockRejectedValueOnce(new Error("unavailable"));
    await using screen = await render(<test.Harness />);
    await screen.getByRole("button", { name: "Paste link", exact: true }).click();
    await expect
      .element(screen.getByRole("status", { name: "Loading links" }))
      .toHaveTextContent("0");
    const stored =
      useComposerDraftStore.getState().getComposerDraft(test.draftTarget)?.prompt ?? "";
    const reference = collectComposerContextReferences(stored)[0]!;
    test.prompt.current = stored;
    test.actions.current!.keepAsText({
      kind: "unread-link",
      contextId: reference.contextId,
      url,
      version: 1,
      label: "ENG-1",
      linkKind: "linear-issue",
      reason: "unreadable",
    });
    expect(test.prompt.current.trim()).toBe(url);
    await screen.getByRole("button", { name: "Finish typing" }).click();
    expect(mocks.resolve).toHaveBeenCalledOnce();
  });

  it("leaves a stored draft alone when the link was edited away while loading", async () => {
    const test = setup();
    await using screen = await render(<test.Harness />);
    await screen.getByRole("button", { name: "Paste link", exact: true }).click();
    useComposerDraftStore.getState().setPrompt(test.draftTarget, "replacement text");
    test.finish();
    await expect
      .element(screen.getByRole("status", { name: "Loading links" }))
      .toHaveTextContent("0");
    expect(test.commit).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(test.draftTarget)?.prompt).toBe(
      "replacement text",
    );
  });
});
