import { COMPOSER_CONTEXT_KINDS, type KnownComposerContextKind } from "@t3tools/contracts";
import { createElement, isValidElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

// Preview bodies pull in the diff worker through the file previews.
vi.mock("@pierre/diffs/worker/worker.js?worker", () => ({ default: function Worker() {} }));

import {
  CONTEXT_PRESENTATION_DEFINITIONS,
  ContextPreviewHover,
  createContextPresentationRegistry,
  type ContextPresentationHandlers,
} from "./contextPresentationRegistry";

const fallback = (kind: string) => createElement("span", { "data-fallback": kind });

/** A surface that draws every kind the same way, unless a kind is left out. */
function surfaceHandlers(options: {
  omit?: KnownComposerContextKind;
  draws?: (record: string) => boolean;
}) {
  const handlers = Object.fromEntries(
    COMPOSER_CONTEXT_KINDS.filter((kind) => kind !== options.omit).map((kind) => [
      kind,
      {
        chip: (record: string) =>
          options.draws?.(record) === false
            ? null
            : {
                trigger: createElement("button", { type: "button" }, record),
                accessibleLabel: record,
                preview: { record },
              },
      },
    ]),
  );
  // Built from the kind list, so the compile-time completeness check can't see it.
  return handlers as unknown as ContextPresentationHandlers<string, undefined>;
}

describe("contextPresentationRegistry", () => {
  it("decides a preview for every known context kind", () => {
    expect(Object.keys(CONTEXT_PRESENTATION_DEFINITIONS)).toEqual(COMPOSER_CONTEXT_KINDS);
    for (const kind of COMPOSER_CONTEXT_KINDS) {
      const preview = CONTEXT_PRESENTATION_DEFINITIONS[kind].preview;
      if (preview.details !== "none") expect(preview.Body, kind).toBeTypeOf("function");
    }
  });

  it("draws every surface's chip inside its kind's registered preview", () => {
    const registry = createContextPresentationRegistry({
      handlers: surfaceHandlers({}),
      fallback,
    });
    for (const kind of COMPOSER_CONTEXT_KINDS) {
      const rendered = registry.render(kind, `${kind} record`, undefined);
      expect(isValidElement(rendered), kind).toBe(true);
      expect(rendered.type, kind).toBe(ContextPreviewHover);
      expect(rendered.props, kind).toMatchObject({
        kind,
        preview: { record: `${kind} record` },
      });
    }
  });

  it("rejects a surface that leaves a kind out", () => {
    expect(() =>
      createContextPresentationRegistry({
        handlers: surfaceHandlers({ omit: "review-comment" }),
        fallback,
      }),
    ).toThrowError("Missing context presentation handler: review-comment");
  });

  it("uses the fallback for unknown kinds, missing records, and records a surface can't draw", () => {
    const registry = createContextPresentationRegistry({
      handlers: surfaceHandlers({ draws: (record) => record !== "stale" }),
      fallback,
    });

    expect(registry.render("terminal", "stale", undefined).props).toEqual({
      "data-fallback": "terminal",
    });
    expect(registry.render("terminal", undefined, undefined).props).toEqual({
      "data-fallback": "terminal",
    });
    expect(registry.render("future-kind", "payload", undefined).props).toEqual({
      "data-fallback": "future-kind",
    });
  });
});
