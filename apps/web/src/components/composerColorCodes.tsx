import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { COLOR_CODE, mayBeIssueReference, wholeColorCode } from "~/lib/colorCodes";
import { ColorCodePreview } from "./chat/ColorCodeChip";
import { composerFloatingLayerProps } from "./chat/composerEventScope";
import { Popover, PopoverPopup, PopoverTitle } from "./ui/popover";

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
    const add = (code: string, offset: number) => {
      if (mayBeIssueReference(code)) return;
      decorations.push(
        Decoration.inline(pos + offset, pos + offset + code.length, {
          class: "composer-color-code",
          style: `--swatch-color: ${code}`,
          "data-color-code": code,
        }),
      );
    };
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

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 120;

/**
 * The swatch preview for a colour under the pointer, matching the chip hover in sent messages.
 * Decorations are plain DOM, so the container delegates hover and one popover anchors to the
 * hovered element. Typing closes it: ProseMirror may redraw that element and strand the anchor.
 */
export function useComposerColorCodeHover() {
  const [target, setTarget] = useState<{ element: HTMLElement; code: string } | null>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const scheduleClose = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const colorCodeElement = (eventTarget: EventTarget | null) =>
    eventTarget instanceof Element ? eventTarget.closest<HTMLElement>("[data-color-code]") : null;

  const containerProps = {
    onPointerOver(event: PointerEvent<HTMLElement>) {
      const element = colorCodeElement(event.target);
      if (!element) return;
      window.clearTimeout(closeTimer.current);
      if (open && target?.element === element) return;
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(
        () => {
          setTarget({ element, code: element.dataset.colorCode ?? "" });
          setOpen(true);
        },
        open ? 0 : OPEN_DELAY_MS,
      );
    },
    onPointerOut(event: PointerEvent<HTMLElement>) {
      const element = colorCodeElement(event.target);
      if (!element || element.contains(event.relatedTarget as Node | null)) return;
      scheduleClose();
    },
    onInput() {
      clearTimers();
      setOpen(false);
    },
  };

  const popover = (
    <Popover open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <PopoverPopup
        {...composerFloatingLayerProps}
        anchor={target?.element}
        side="top"
        padding="compact"
        initialFocus={false}
        finalFocus={false}
        onPointerEnter={() => window.clearTimeout(closeTimer.current)}
        onPointerLeave={scheduleClose}
      >
        <PopoverTitle className="sr-only">Colour {target?.code}</PopoverTitle>
        {target ? <ColorCodePreview code={target.code} /> : null}
      </PopoverPopup>
    </Popover>
  );

  return { containerProps, popover };
}
