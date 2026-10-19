import * as Schema from "effect/Schema";
import { TerminalIcon } from "lucide-react";
import type { CSSProperties } from "react";

import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import type { ContextPresentationCapability } from "../contextPresentationRegistry";
import { ContextChipPopover, ContextChipShell } from "../contextChipParts";
import { useClientSettings } from "../../hooks/useSettings";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { terminalFontFamily } from "~/terminal/ghostty/surface";
import type { GhosttyColor } from "~/terminal/ghostty/core";
import { useTheme } from "../../hooks/useTheme";
import {
  parseTerminalStyledText,
  resolveTerminalTextColor,
  type TerminalTextRun,
} from "../../lib/terminalStyledText";
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
 * The terminal theme lives in CSS, so the compiler can't see it change. Taking the theme as
 * arguments re-reads it on every theme change; two palettes can share a light/dark resolution.
 */
function readTerminalTheme(_theme: string, _resolvedTheme: string) {
  return terminalThemeFromApp();
}

function cssRgb({ r, g, b }: GhosttyColor): string {
  return `rgb(${r} ${g} ${b})`;
}

interface TerminalBackgroundSpan {
  readonly background: string | undefined;
  readonly runs: ReadonlyArray<{ readonly text: string; readonly style: CSSProperties }>;
}

/**
 * Resolve runs to CSS and group consecutive runs that share a background, so each stretch of
 * background is painted by one box. Cells sit at fractional pixel offsets, and two adjacent boxes
 * of the same color each antialias their shared edge, leaving a hairline seam between them.
 */
function terminalBackgroundSpans(
  runs: ReadonlyArray<TerminalTextRun>,
  palette: ReadonlyArray<GhosttyColor>,
  defaults: { foreground: string; background: string },
): TerminalBackgroundSpan[] {
  const spans: Array<{
    background: string | undefined;
    runs: TerminalBackgroundSpan["runs"][number][];
  }> = [];
  for (const { text, style } of runs) {
    let color = style.foreground ? resolveTerminalTextColor(style.foreground, palette) : undefined;
    let background = style.background
      ? resolveTerminalTextColor(style.background, palette)
      : undefined;
    if (style.inverse) {
      [color, background] = [background ?? defaults.background, color ?? defaults.foreground];
    }
    const decorations = [
      style.underline ? "underline" : "",
      style.strikethrough ? "line-through" : "",
      style.overline ? "overline" : "",
    ].filter((decoration) => decoration.length > 0);
    const run = {
      text,
      style: {
        ...(style.invisible ? { color: "transparent" } : color ? { color } : {}),
        ...(style.bold ? { fontWeight: 700 } : {}),
        ...(style.italic ? { fontStyle: "italic" } : {}),
        ...(style.faint ? { opacity: 0.6 } : {}),
        ...(decorations.length > 0 ? { textDecorationLine: decorations.join(" ") } : {}),
      },
    };
    const last = spans.at(-1);
    if (last && last.background === background) last.runs.push(run);
    else spans.push({ background, runs: [run] });
  }
  return spans;
}

/**
 * Captured output drawn the way the terminal drew it: the user's terminal font, so prompt
 * glyphs render, and the terminal theme, so the captured colors read as they did there.
 */
function TerminalExcerptText({
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
  const foreground = cssRgb(terminalTheme.foreground);
  const background = cssRgb(terminalTheme.background);
  const spans =
    styledText === undefined
      ? null
      : terminalBackgroundSpans(parseTerminalStyledText(styledText), terminalTheme.palette ?? [], {
          foreground,
          background,
        });

  return (
    <pre
      className="max-h-80 overflow-y-auto whitespace-pre-wrap wrap-break-word p-3 outline-none [tab-size:4] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{
        fontFamily: terminalFontFamily(family),
        fontSize,
        lineHeight,
        color: foreground,
        backgroundColor: background,
      }}
      aria-label="Captured terminal output"
      tabIndex={0}
    >
      {spans === null
        ? text
        : spans.map((span, spanIndex) => (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- Runs never reorder; the index is their identity.
              key={spanIndex}
              style={span.background ? { backgroundColor: span.background } : undefined}
            >
              {span.runs.map((run, runIndex) => (
                // oxlint-disable-next-line react/no-array-index-key -- Runs never reorder; the index is their identity.
                <span key={runIndex} style={run.style}>
                  {run.text}
                </span>
              ))}
            </span>
          ))}
    </pre>
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
          <TerminalExcerptText text={text} styledText={styledText} />
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
