import type { Editor } from "@tiptap/core";
import { createRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import { userEvent } from "vite-plus/test/browser";

import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorProps,
} from "./ComposerPromptEditor";

const URL = "https://github.com/pingdotgg/t3code/pull/410";
const PROMPT = `Review ${URL} please`;

function loadingChip(container: HTMLElement) {
  return container.querySelector('[data-slot="context-chip"][data-state="loading"]');
}

function prompt(
  loadingLinkUrls: ReadonlyArray<string>,
  onChange: ComposerPromptEditorProps["onChange"] = () => {},
) {
  return (
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
    />
  );
}

describe("loading link placeholders", () => {
  it("stands a labelled chip in for the link's text while it loads, and gives the text back", async () => {
    await using screen = await render(prompt([URL]));
    const container = screen.container;
    expect(loadingChip(container)?.textContent).toBe("pingdotgg/t3code#410");
    expect(container.querySelector(".composer-loading-link-text")?.textContent).toBe(URL);

    await screen.rerender(prompt([]));
    expect(loadingChip(container)).toBeNull();
    expect(container.querySelector(".composer-loading-link-text")).toBeNull();
    expect(container.querySelector(".tiptap")?.textContent).toBe(PROMPT);
  });

  it("removes the whole link when the caret deletes into its placeholder", async () => {
    const onChange = vi.fn<ComposerPromptEditorProps["onChange"]>();
    await using screen = await render(prompt([URL], onChange));
    const container = screen.container;
    const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap")!;
    await userEvent.click(element);
    const editor = element.editor;
    const linkEnd = PROMPT.indexOf(URL) + URL.length + 1;
    await act(async () => {
      editor.commands.setTextSelection(linkEnd);
    });
    await userEvent.keyboard("{Backspace}");
    expect(onChange.mock.lastCall?.[0]).toBe("Review  please");
    expect(loadingChip(container)).toBeNull();
  });
});
