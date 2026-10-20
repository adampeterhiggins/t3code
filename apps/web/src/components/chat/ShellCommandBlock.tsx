import {
  commandHighlightLanguage,
  withVisibleControlCharacters,
} from "@t3tools/client-runtime/work-log/command-label";
import { Suspense, use } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import type { CommandScriptPreview } from "../../lib/embeddedScripts";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { HighlightedTokens } from "./HighlightedTokens";

const WORD_CLASS_NAME = "inline-block max-w-full [overflow-wrap:anywhere]";

// The shell parser loads with the first highlighted preview, not with the timeline.
let embeddedScriptsModule: Promise<typeof import("../../lib/embeddedScripts")> | undefined;
function loadEmbeddedScripts() {
  embeddedScriptsModule ??= import("../../lib/embeddedScripts");
  return embeddedScriptsModule;
}

/** Same layout as the highlighted version, so the grammar arriving never reflows the block. */
function PlainWords({ code }: { code: string }) {
  return code.split(/(\s+)/u).map((part, index) =>
    index % 2 === 1 || part === "" ? (
      part
    ) : (
      // Positions are stable for a given string, which is all this renders.
      // oxlint-disable-next-line react/no-array-index-key
      <span key={index} className={WORD_CLASS_NAME}>
        {part}
      </span>
    ),
  );
}

function HighlightedCommand({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const { commandScriptPreview, embeddedScripts } = use(loadEmbeddedScripts());
  const preview = commandScriptPreview(code);
  if (preview) return <InterpreterScript preview={preview} />;
  return <ShellSyntax code={code} theme={theme} embeddedScripts={embeddedScripts} />;
}

function ShellSyntax({
  code,
  theme,
  embeddedScripts,
}: {
  code: string;
  theme: "light" | "dark";
  embeddedScripts: typeof import("../../lib/embeddedScripts").embeddedScripts;
}) {
  const language = commandHighlightLanguage(code);
  // Only shell syntax nests scripts; PowerShell's own grammar colors its strings.
  const embedded = language === "shellscript" ? embeddedScripts(code) : [];
  return (
    <HighlightedTokens
      code={code}
      language={language}
      embedded={embedded}
      theme={theme}
      wordClassName={WORD_CLASS_NAME}
    />
  );
}

/** A lone `python3 -c` (or heredoc, `node -e`, …) scrolls as that language. */
function InterpreterScript({ preview }: { preview: CommandScriptPreview }) {
  return (
    <div className="min-w-0 space-y-1">
      {preview.invocation ? (
        <div className="text-muted-foreground">{preview.invocation}</div>
      ) : null}
      <pre className="max-h-80 min-w-0 max-w-full overflow-auto whitespace-pre break-normal wrap-normal">
        <HighlightedSnippet text={preview.text} lang={preview.language} />
      </pre>
    </div>
  );
}

/**
 * The command a command_execution item ran. Highlighted previews show a lone
 * interpreter script as that language; other commands stay shell, with nested
 * scripts such as a Python heredoc colored inside them.
 */
export function ShellCommandBlock({
  command,
  highlightSyntax = false,
}: {
  command: string;
  highlightSyntax?: boolean | undefined;
}) {
  const resolvedTheme = useRenderedAppearance();
  const code = withVisibleControlCharacters(command.trim());
  if (!code) return null;
  const plain = <PlainWords code={code} />;
  return (
    <div className="min-w-0 text-foreground/85">
      {highlightSyntax ? (
        <RenderErrorBoundary fallback={plain} resetKeys={[code]}>
          <Suspense fallback={plain}>
            <HighlightedCommand code={code} theme={resolvedTheme} />
          </Suspense>
        </RenderErrorBoundary>
      ) : (
        plain
      )}
    </div>
  );
}
