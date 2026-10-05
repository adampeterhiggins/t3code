import { Suspense, use, useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";

import { RenderErrorBoundary } from "./RenderErrorBoundary";

/** Preserve the command's whitespace and highlight it as shell code. */
export function ToolCallCommand({ command }: { command: string }) {
  const { resolvedTheme } = useTheme();
  return (
    <pre className="min-w-0 flex-1 overflow-auto rounded-md bg-muted/40 px-3 py-2 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text">
      <code>
        <RenderErrorBoundary fallback={command} resetKeys={[command, resolvedTheme]}>
          <Suspense fallback={command}>
            <HighlightedCommand command={command} theme={resolvedTheme} />
          </Suspense>
        </RenderErrorBoundary>
      </code>
    </pre>
  );
}

function HighlightedCommand({ command, theme }: { command: string; theme: "light" | "dark" }) {
  const highlighter = use(getSyntaxHighlighterPromise("shellscript"));
  const lines = useMemo(
    () =>
      highlighter.codeToTokens(command, {
        lang: "shellscript",
        theme: resolveDiffThemeName(theme),
      }).tokens,
    [command, highlighter, theme],
  );
  let lineOffset = 0;
  return lines.map((line) => {
    const offset = lineOffset;
    lineOffset += line.reduce((length, token) => length + token.content.length, 0) + 1;
    return (
      <span key={offset}>
        {line.map((token) => (
          <span key={token.offset} style={{ color: token.color }}>
            {token.content}
          </span>
        ))}
        {lineOffset <= command.length ? "\n" : null}
      </span>
    );
  });
}
