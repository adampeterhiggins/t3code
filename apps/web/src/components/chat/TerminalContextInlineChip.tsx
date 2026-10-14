import * as Schema from "effect/Schema";
import { TerminalIcon } from "lucide-react";

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

interface TerminalContextInlineChipProps {
  label: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  detailsMode: ContextPresentationCapability["details"];
  expired?: boolean;
}

/** Captured output, set in the user's terminal font so prompt glyphs render as they did there. */
function TerminalExcerptText({ text }: { text: string }) {
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

  return (
    <pre
      className="max-h-80 overflow-y-auto whitespace-pre-wrap wrap-break-word bg-muted p-3 text-foreground outline-none [tab-size:4] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{ fontFamily: terminalFontFamily(family), fontSize, lineHeight }}
      aria-label="Captured terminal output"
      tabIndex={0}
    >
      {text}
    </pre>
  );
}

export function TerminalContextInlineChip(props: TerminalContextInlineChipProps) {
  const { label, terminalLabel, lineStart, lineEnd, text, detailsMode, expired = false } = props;

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
          <TerminalExcerptText text={text} />
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
