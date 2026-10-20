import * as Schema from "effect/Schema";
import { Check, Copy } from "lucide";
import { TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import type { ContextPresentationCapability } from "../contextPresentationRegistry";
import { ContextChipPopover, ContextChipShell } from "../contextChipParts";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import { useClientSettings } from "../../hooks/useSettings";
import { useCopyToClipboard, writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { readLocalApi } from "~/localApi";
import {
  GhosttyTerminalSurface,
  preloadGhosttyTerminal,
  terminalFontFamily,
} from "~/terminal/ghostty/surface";
import type { GhosttyColor } from "~/terminal/ghostty/core";
import { useTheme } from "../../hooks/useTheme";
import { terminalTextColumns } from "../../lib/terminalContext";
import { terminalThemeFromApp } from "../ThreadTerminalDrawer";

interface TerminalContextInlineChipProps {
  label: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  /** `text` with its terminal colors; the preview falls back to `text` without it. */
  styledText?: string | undefined;
  detailsMode: ContextPresentationCapability["details"];
  expired?: boolean;
}

/**
 * Past this many columns the excerpt wraps instead: the canvas is as wide as the grid, and a
 * backing store tens of thousands of pixels wide is more memory than a hover card deserves.
 */
const MAX_PREVIEW_COLUMNS = 400;
/** Taller excerpts scroll inside the preview, through the terminal's own scrollback. */
const MAX_PREVIEW_ROWS = 16;
/** DECTCEM off: a read-only excerpt has no insertion point. */
const HIDE_CURSOR = "\x1b[?25l";

/**
 * The terminal theme lives in CSS, so the compiler can't see it change. Taking the theme as
 * arguments re-reads it on every theme change; two palettes can share a light/dark resolution.
 */
function readTerminalTheme(_theme: string, _resolvedTheme: string) {
  return terminalThemeFromApp();
}

function cssRgb({ r, g, b }: GhosttyColor): string {
  return `rgb(${r} ${g} ${b})`;
}

/**
 * The terminal autoscrolls a selection drag vertically through its scrollback, but sideways
 * scrolling belongs to the card's scroller. While a mouse drag is past its left or right edge,
 * scroll it, faster the further out the pointer is, and keep extending the selection.
 */
function followSelectionDragSideways(
  surface: GhosttyTerminalSurface,
  scroller: HTMLElement,
): () => void {
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  const step = () => {
    frame = 0;
    if (pointer === null) return;
    const bounds = scroller.getBoundingClientRect();
    const overshoot =
      pointer.x < bounds.left
        ? pointer.x - bounds.left
        : pointer.x > bounds.right
          ? pointer.x - bounds.right
          : 0;
    if (overshoot === 0) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft +=
      Math.sign(overshoot) * Math.min(40, Math.max(4, Math.abs(overshoot) / 3));
    if (scroller.scrollLeft === before) return;
    surface.extendSelectionDrag(pointer.x, pointer.y);
    frame = window.requestAnimationFrame(step);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0 && event.pointerType !== "touch") {
      pointer = { x: event.clientX, y: event.clientY };
    }
  };
  // The surface captures the pointer for a drag, so its moves reach the canvas from anywhere.
  const onPointerMove = (event: PointerEvent) => {
    if (pointer === null) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (frame === 0) frame = window.requestAnimationFrame(step);
  };
  const onPointerEnd = () => {
    pointer = null;
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = 0;
  };
  surface.canvas.addEventListener("pointerdown", onPointerDown);
  surface.canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  return () => {
    onPointerEnd();
    surface.canvas.removeEventListener("pointerdown", onPointerDown);
    surface.canvas.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerEnd);
    window.removeEventListener("pointercancel", onPointerEnd);
  };
}

/**
 * Captured output drawn by the terminal's own renderer, read-only. Selection, copy, and
 * scrolling are the terminal drawer's, so the excerpt behaves exactly as it did there. The grid
 * is as wide as the widest line, so lines never rewrap; the card scrolls sideways instead.
 * Until the renderer loads, or if it can't, the excerpt shows as plain text.
 */
function TerminalExcerptPreview({
  terminalLabel,
  lineStart,
  lineEnd,
  text,
  styledText,
}: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  styledText?: string | undefined;
}) {
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const family = useClientSettings((settings) =>
    resolveTerminalFontPreference({
      advanced: advancedTypography,
      code: settings.fontFamilyCode,
      terminal: settings.fontFamilyTerminal,
    }),
  );
  const fontSize = useClientSettings((settings) =>
    resolveTerminalFontSizePreference({
      advanced: advancedTypography,
      code: settings.fontSizeCode,
      terminal: settings.fontSizeTerminal,
    }),
  );
  // Stored as a percentage of the font size.
  const lineHeight = useClientSettings((settings) => settings.terminalLineHeight / 100);
  const { theme, resolvedTheme } = useTheme();
  const terminalTheme = readTerminalTheme(theme, resolvedTheme);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1500,
    target: "terminal excerpt",
  });
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<GhosttyTerminalSurface | null>(null);

  const lines = (styledText ?? text).split("\n");
  const cols = Math.min(
    MAX_PREVIEW_COLUMNS,
    Math.max(1, ...text.split("\n").map((line) => terminalTextColumns(line))),
  );
  const rows = Math.min(MAX_PREVIEW_ROWS, lines.length);
  const content = HIDE_CURSOR + lines.join("\r\n");
  const trimmedFamily = family.trim();

  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollerRef.current;
    const mount = mountRef.current;
    if (!frame || !scroller || !mount) return;
    let cancelled = false;
    let stopFollowingDrag: (() => void) | null = null;
    void GhosttyTerminalSurface.create(mount, {
      theme: terminalThemeFromApp(),
      font: {
        ...(trimmedFamily.length > 0 ? { family: trimmedFamily } : {}),
        size: fontSize,
        lineHeight,
      },
      readOnly: true,
      onData: () => {},
      onResize: () => {},
      onSelectionChange: () => {},
      beforeKey: () => true,
      onLinkActivate: () => {},
      canActivateLink: () => false,
      onContextMenu: (event) => {
        const localApi = readLocalApi();
        const surface = surfaceRef.current;
        if (!localApi || !surface) return;
        // Own the gesture: the browser's menu has no Copy for a canvas.
        event.preventDefault();
        const selection = surface.getSelection();
        void localApi.contextMenu
          .show(
            [
              { id: "copy", label: "Copy", disabled: selection.length === 0 },
              { id: "select-all", label: "Select all" },
            ],
            { x: event.clientX, y: event.clientY },
          )
          .then(
            (clicked) => {
              if (clicked === "copy") void writeTextToClipboard(selection, "terminal selection");
              if (clicked === "select-all") surfaceRef.current?.selectAll();
            },
            () => {},
          );
      },
    }).then(
      (surface) => {
        if (cancelled) {
          surface.dispose();
          return;
        }
        surfaceRef.current = surface;
        // The mount scrolls sideways, which would carry the scrollbar out of view with it.
        frame.append(surface.scrollbar);
        surface.sizeToGrid(cols, rows);
        surface.resetAndWrite(content);
        surface.scrollToTop();
        stopFollowingDrag = followSelectionDragSideways(surface, scroller);
        setStatus("ready");
      },
      () => {
        if (!cancelled) setStatus("failed");
      },
    );
    return () => {
      cancelled = true;
      stopFollowingDrag?.();
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
  }, [content, cols, rows, trimmedFamily, fontSize, lineHeight]);

  useEffect(() => {
    surfaceRef.current?.setTheme(readTerminalTheme(theme, resolvedTheme));
  }, [theme, resolvedTheme]);

  const foreground = cssRgb(terminalTheme.foreground);
  const ready = status === "ready";
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-background/80">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <TerminalIcon className="size-4 shrink-0 text-success" aria-hidden />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {terminalLabel}
        </span>
        <span className="ml-auto shrink-0 text-secondary-label text-xs">
          {lineStart === lineEnd ? `Line ${lineStart}` : `Lines ${lineStart}–${lineEnd}`}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Copy selection, or the whole excerpt"
          onClick={() => {
            const selection = surfaceRef.current?.getSelection() ?? "";
            copyToClipboard(selection.length > 0 ? selection : text, undefined);
          }}
        >
          <MorphIcon className="size-3.5" icon={isCopied ? Check : Copy} />
        </Button>
      </div>
      <div
        ref={frameRef}
        className="relative"
        style={{ backgroundColor: cssRgb(terminalTheme.background) }}
      >
        <div ref={scrollerRef} className="max-h-80 overflow-x-auto overflow-y-hidden">
          <div
            ref={mountRef}
            className={ready ? "relative" : "invisible absolute top-0 left-0"}
            // Estimated until the surface measures its font and sizes the mount exactly.
            style={{
              width: `calc(${cols}ch + 8px)`,
              height: `calc(${rows * lineHeight}em + 8px)`,
              fontSize,
            }}
          />
          {ready ? null : (
            <pre
              className="p-1 whitespace-pre"
              style={{
                fontFamily: terminalFontFamily(family),
                fontSize,
                lineHeight,
                color: foreground,
              }}
            >
              {text}
            </pre>
          )}
        </div>
        {ready ? <pre className="sr-only">{text}</pre> : null}
      </div>
    </div>
  );
}

export function TerminalContextInlineChip(props: TerminalContextInlineChipProps) {
  const {
    label,
    terminalLabel,
    lineStart,
    lineEnd,
    text,
    styledText,
    detailsMode,
    expired = false,
  } = props;

  if (!expired && text.length > 0 && detailsMode === "popover") {
    return (
      <ContextChipPopover
        kind="terminal"
        icon={<TerminalIcon />}
        label={label}
        accessibleLabel={`Terminal excerpt, ${label}`}
        onIntent={preloadGhosttyTerminal}
        stayOpenAfterPress
      >
        <TerminalExcerptPreview
          terminalLabel={terminalLabel}
          lineStart={lineStart}
          lineEnd={lineEnd}
          text={text}
          styledText={styledText}
        />
      </ContextChipPopover>
    );
  }

  return (
    <ContextChipShell
      kind="terminal"
      {...(expired ? { state: "invalid" as const } : {})}
      icon={<TerminalIcon />}
      label={label}
      aria-label={`Terminal excerpt, ${label}${expired ? ", expired" : ""}`}
      data-terminal-context-expired={expired ? "true" : undefined}
      tooltip={
        expired
          ? `Terminal context expired. Remove and re-add ${label} to include it in your message.`
          : detailsMode === "none"
            ? undefined
            : text
      }
    />
  );
}
