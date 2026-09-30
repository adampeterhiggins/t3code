import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { parseToolCallBody } from "~/lib/toolCallBody";

import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

/** Render tool patches with the same unified diff view as the rest of the app. */
export function ToolCallBody({ text, className }: { text: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const blocks = useMemo(() => parseToolCallBody(text), [text]);
  return (
    <div
      className={cn(
        "space-y-2 overflow-auto font-mono text-2xs leading-relaxed select-text",
        className,
      )}
    >
      {blocks.map((block) =>
        block.kind === "diff" ? (
          <DiffWorkerPoolProvider key={block.text}>
            <div aria-label="Edit diff" className="overflow-hidden rounded-md border">
              {block.files.map((file) => (
                <FileDiff
                  key={file.name}
                  fileDiff={file}
                  options={{
                    diffStyle: "unified",
                    diffIndicators: "classic",
                    theme: resolveDiffThemeName(resolvedTheme),
                    preferredHighlighter: PREFERRED_HIGHLIGHTER,
                    disableFileHeader: true,
                    disableLineNumbers: true,
                    overflow: "wrap",
                  }}
                />
              ))}
            </div>
          </DiffWorkerPoolProvider>
        ) : (
          <pre key={block.text} className="whitespace-pre-wrap break-words font-mono">
            {block.text}
          </pre>
        ),
      )}
    </div>
  );
}
