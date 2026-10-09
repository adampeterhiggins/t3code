import { Suspense, use, useMemo } from "react";

import { useTheme } from "../../hooks/useTheme";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { RenderErrorBoundary } from "../RenderErrorBoundary";

function SnippetTokens({ text, lang }: { readonly text: string; readonly lang: string }) {
  const { resolvedTheme } = useTheme();
  const highlighter = use(getSyntaxHighlighterPromise(lang));
  const { tokens } = useMemo(
    () => highlighter.codeToTokens(text, { lang, theme: resolveDiffThemeName(resolvedTheme) }),
    [highlighter, text, lang, resolvedTheme],
  );
  return tokens.flatMap((line, lineIndex) => [
    lineIndex > 0 ? "\n" : "",
    ...line.map((token) => (
      <span key={token.offset} style={{ color: token.color }}>
        {token.content}
      </span>
    )),
  ]);
}

/** Inline syntax-highlighted text for a tool's arguments or result; plain until the highlighter loads. */
export function HighlightedSnippet({
  text,
  lang,
}: {
  readonly text: string;
  readonly lang: string;
}) {
  return (
    <RenderErrorBoundary fallback={text}>
      <Suspense fallback={text}>
        <SnippetTokens text={text} lang={lang} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
