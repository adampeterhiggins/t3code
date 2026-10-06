import { getFiletypeFromFileName } from "@pierre/diffs";
import type { ReadFileOutput } from "@t3tools/client-runtime/work-log/item-detail";
import { Suspense, use, useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

import { RenderErrorBoundary } from "../RenderErrorBoundary";

/** Larger reads render as plain text so opening one never stalls on tokenizing. */
const MAX_HIGHLIGHTED_CHARS = 60_000;

function HighlightedSource(props: { text: string; language: string }) {
  const { resolvedTheme } = useTheme();
  const highlighter = use(getSyntaxHighlighterPromise(props.language));
  const { tokens } = useMemo(
    () =>
      highlighter.codeToTokens(props.text, {
        lang: props.language,
        theme: resolveDiffThemeName(resolvedTheme),
      }),
    [highlighter, props.language, props.text, resolvedTheme],
  );
  return tokens.flatMap((line, lineIndex) => [
    lineIndex > 0 ? "\n" : "",
    ...line.map((token) => (
      <span key={`${lineIndex}:${token.offset}`} style={{ color: token.color }}>
        {token.content}
      </span>
    )),
  ]);
}

/**
 * Fork: a file read's contents, highlighted for the file's language and numbered from the
 * line the read started at.
 */
export function ReadFileView(props: { file: ReadFileOutput; className?: string }) {
  const { file } = props;
  const lineNumbers = useMemo(() => {
    const count = file.text.split("\n").length;
    return Array.from({ length: count }, (_, index) => file.startLine + index).join("\n");
  }, [file.startLine, file.text]);
  const language = file.path ? getFiletypeFromFileName(file.path) : "text";
  return (
    <div
      className={cn(
        "flex overflow-auto font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed",
        props.className,
      )}
    >
      <pre aria-hidden className="shrink-0 pe-3 text-right text-muted-foreground/60 select-none">
        {lineNumbers}
      </pre>
      <pre className="min-w-0 flex-1 text-foreground/85 select-text">
        {file.text.length > MAX_HIGHLIGHTED_CHARS || language === "text" ? (
          file.text
        ) : (
          <RenderErrorBoundary fallback={file.text}>
            <Suspense fallback={file.text}>
              <HighlightedSource text={file.text} language={language} />
            </Suspense>
          </RenderErrorBoundary>
        )}
      </pre>
    </div>
  );
}
