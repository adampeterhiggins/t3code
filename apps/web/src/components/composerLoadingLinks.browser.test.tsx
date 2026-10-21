import type { Editor } from "@tiptap/core";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorProps,
} from "./ComposerPromptEditor";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const URL = "https://github.com/pingdotgg/t3code/pull/410";
const PROMPT = `Review ${URL} please`;

async function render(
  loadingLinkUrls: ReadonlyArray<string>,
  onChange: ComposerPromptEditorProps["onChange"] = () => {},
) {
  await act(async () =>
    root.render(
      <ComposerPromptEditor
        editorRef={createRef<ComposerPromptEditorHandle>()}
        value={PROMPT}
        cursor={PROMPT.length}
        richTextEnabled
        contextRecords={new Map()}
        loadingLinkUrls={loadingLinkUrls}
        skills={[]}
        disabled={false}
        placeholder=""
        onChange={onChange}
        onPaste={() => {}}
      />,
    ),
  );
  // A placeholder chip renders into its own root, a microtask after the editor draws it.
  await act(async () => {});
  const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  return element.editor;
}

const loadingChip = () =>
  container.querySelector('[data-slot="context-chip"][data-state="loading"]');

describe("loading link placeholders", () => {
  it("stands a labelled chip in for the link's text while it loads, and gives the text back", async () => {
    await render([URL]);
    expect(loadingChip()?.textContent).toBe("pingdotgg/t3code#410");
    expect(container.querySelector(".composer-loading-link-text")?.textContent).toBe(URL);

    await render([]);
    expect(loadingChip()).toBeNull();
    expect(container.querySelector(".composer-loading-link-text")).toBeNull();
    expect(container.querySelector(".tiptap")?.textContent).toBe(PROMPT);
  });

  it("removes the whole link when the caret deletes into its placeholder", async () => {
    const onChange = vi.fn<ComposerPromptEditorProps["onChange"]>();
    const editor = await render([URL], onChange);
    const linkEnd = PROMPT.indexOf(URL) + URL.length + 1;
    await act(async () => {
      editor.commands.focus();
      editor.commands.setTextSelection(linkEnd);
    });
    await act(async () => userEvent.keyboard("{Backspace}"));
    expect(onChange.mock.lastCall?.[0]).toBe("Review  please");
    expect(loadingChip()).toBeNull();
  });
});
