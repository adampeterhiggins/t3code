import * as Schema from "effect/Schema";
import { TerminalIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import type { ContextPresentationCapability } from "../contextPresentationRegistry";
import { ContextChipPopover, ContextChipShell } from "../contextChipParts";
import { useClientSettings } from "../../hooks/useSettings";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { GhosttyTerminalSurface } from "~/terminal/ghostty/surface";
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
 * Captured output drawn by the terminal's own renderer, read-only. Selection, copy, and
 * scrolling are the terminal drawer's, so the excerpt behaves exactly as it did there. The grid
 * is as wide as the widest line, so lines never rewrap; the card scrolls sideways instead.
 */
function TerminalExcerptPreview({
  text,
  styledText,
}: {
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
  const frameRef = useRef<HTMLDivElement>(null);
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
    const mount = mountRef.current;
    if (!frame || !mount) return;
    let cancelled = false;
    void GhosttyTerminalSurface.create(mount, {
      theme: terminalThemeFromApp(),
      font: {
        ...(trimmedFamily.length > 0 ? { family: trimmedFamily } : {}),
        size: fontSize,
        lineHeight,
      },
      onData: () => {},
      onResize: () => {},
      onSelectionChange: () => {},
      // Escape closes the card and Tab leaves it; neither is input for a read-only excerpt.
      beforeKey: (event) => event.key !== "Escape" && event.key !== "Tab",
      onLinkActivate: () => {},
      canActivateLink: () => false,
    }).then(
      (surface) => {
        if (cancelled) {
          surface.dispose();
          return;
        }
        surfaceRef.current = surface;
        surface.input.readOnly = true;
        // The mount scrolls sideways, which would carry the scrollbar out of view with it.
        frame.append(surface.scrollbar);
        surface.sizeToGrid(cols, rows);
        surface.resetAndWrite(content);
        surface.scrollToTop();
      },
      () => {},
    );
    return () => {
      cancelled = true;
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
  }, [content, cols, rows, trimmedFamily, fontSize, lineHeight]);

  useEffect(() => {
    surfaceRef.current?.setTheme(readTerminalTheme(theme, resolvedTheme));
  }, [theme, resolvedTheme]);

  return (
    <div
      ref={frameRef}
      className="relative"
      style={{ backgroundColor: cssRgb(terminalTheme.background) }}
    >
      <div className="overflow-x-auto overflow-y-hidden">
        <div
          ref={mountRef}
          className="relative"
          // Estimated until the surface measures its font and sizes the mount exactly.
          style={{
            width: `calc(${cols}ch + 8px)`,
            height: `calc(${rows * lineHeight}em + 8px)`,
            fontSize,
          }}
        />
      </div>
      <pre className="sr-only">{text}</pre>
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
      >
        <div className="overflow-hidden rounded-md border border-border/70 bg-background/80">
          <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
            <TerminalIcon className="size-4 shrink-0 text-success" aria-hidden />
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {terminalLabel}
            </span>
            <span className="ml-auto shrink-0 text-secondary-label text-xs">
              {lineStart === lineEnd ? `Line ${lineStart}` : `Lines ${lineStart}–${lineEnd}`}
            </span>
          </div>
          <TerminalExcerptPreview text={text} styledText={styledText} />
        </div>
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
