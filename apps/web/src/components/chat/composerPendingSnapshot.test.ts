import { describe, expect, it } from "vite-plus/test";

import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  replaceTextRange,
} from "../../composer-logic";
import {
  collectInlineContextIds,
  formatInlineContextReference,
  insertInlineContextReference,
} from "../../lib/composerContextReferences";
import { resolveComposerSnapshot, type ComposerSnapshot } from "./composerPendingSnapshot";

const reference = {
  kind: "repository" as const,
  contextId: "repository_dashboard",
  label: "focaldata/fd-dashboard",
};

function snapshot(value: string, expandedCursor: number): ComposerSnapshot {
  return {
    value,
    expandedCursor,
    cursor: collapseExpandedComposerCursor(value, expandedCursor),
    contextIds: collectInlineContextIds(value),
  };
}

describe("context insertion before the controlled editor catches up", () => {
  it.each(["", `${formatInlineContextReference(reference)} `])(
    "replaces a mid-message # query at its original position with preceding context %j",
    (prefix) => {
      const value = `${prefix}Raise PRs in #dashboard, each of which imports fd-common`;
      const editor = snapshot(value, value.indexOf(","));
      const trigger = detectComposerTrigger(value, editor.expandedCursor)!;
      const removed = replaceTextRange(value, trigger.rangeStart, trigger.rangeEnd, "");
      const pending = snapshot(removed.text, removed.cursor);
      const caret = resolveComposerSnapshot(removed.text, editor, pending)!;
      const inserted = insertInlineContextReference(removed.text, caret.expandedCursor, reference);
      expect(inserted.prompt).toBe(
        `${prefix}Raise PRs in ${formatInlineContextReference(reference)} , each of which imports fd-common`,
      );

      // Multiple selections can insert synchronously before any editor render.
      const secondCaret = resolveComposerSnapshot(
        inserted.prompt,
        editor,
        snapshot(inserted.prompt, inserted.cursor),
      )!;
      const second = insertInlineContextReference(inserted.prompt, secondCaret.expandedCursor, {
        ...reference,
        contextId: "repository_common",
        label: "focaldata/fd-common",
      });
      expect(second.prompt).toContain(
        `${formatInlineContextReference(reference)} [focaldata/fd-common]`,
      );
      expect(second.prompt).toContain(", each of which imports fd-common");
    },
  );

  it("uses the live caret once the editor applies the replacement", () => {
    const value = "Raise PRs in , each of which imports fd-common";
    const pending = snapshot(value, value.indexOf(","));
    const editor = snapshot(value, value.length);
    expect(resolveComposerSnapshot(value, editor, pending)).toBe(editor);
  });

  it("does not reuse a pending caret after another draft change", () => {
    const pending = snapshot("Old draft", 0);
    const editor = snapshot("New draft", 4);
    expect(resolveComposerSnapshot(editor.value, editor, pending)).toBe(editor);
  });
});
