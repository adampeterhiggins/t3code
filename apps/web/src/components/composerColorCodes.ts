import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { COLOR_CODE, wholeColorCode } from "~/lib/colorCodes";

/**
 * Fork: draws colour codes in the composer with a swatch, the way sent messages show them.
 * A decoration rather than a chip node, so the prompt stays plain text the user can edit.
 */
function colorCodeDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return true;
    const inCode = node.marks.some((mark) => mark.type.spec.code);
    const add = (code: string, offset: number) =>
      decorations.push(
        Decoration.inline(pos + offset, pos + offset + code.length, {
          class: "composer-color-code",
          style: `--swatch-color: ${code}`,
        }),
      );
    if (inCode) {
      const code = wholeColorCode(node.text);
      if (code) add(code, node.text.indexOf(code));
      return false;
    }
    for (const match of node.text.matchAll(COLOR_CODE)) add(match[0], match.index);
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const ColorCodePluginKey = new PluginKey<DecorationSet>("composer-color-codes");

export const ComposerColorCodesExtension = Extension.create({
  name: "composer-color-codes",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ColorCodePluginKey,
        state: {
          init: (_, state) => colorCodeDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? colorCodeDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => ColorCodePluginKey.getState(state),
        },
      }),
    ];
  },
});
