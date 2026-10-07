import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { parseToolCallBody } from "~/lib/toolCallBody";

import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

/** Render tool patches with the same unified diff view as the rest of the app. */
export function ToolCallBody({ text, className }: { text: string; className?: string }) {
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
          <ToolDiff key={block.text} patch={block.text} files={block.files} />
        ) : (
          <pre key={block.text} className="whitespace-pre-wrap break-words font-mono">
            {block.text}
          </pre>
        ),
      )}
    </div>
  );
}

/** A tool patch that falls back to its plain text if the diff renderer fails. */
function ToolDiff(props: { patch: string; files: ReadonlyArray<FileDiffMetadata> }) {
  const { resolvedTheme } = useTheme();
  const [failed, setFailed] = useState(false);
  const options = useMemo<FileDiffOptions<undefined, false>>(
    () => ({
      diffStyle: "unified",
      diffIndicators: "classic",
      theme: resolveDiffThemeName(resolvedTheme),
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      disableFileHeader: true,
      disableLineNumbers: true,
      overflow: "wrap",
      // The renderer reports failures by drawing its own error and stack trace.
      onPostRender: (node) => {
        if (node.shadowRoot?.querySelector("[data-error-wrapper]")) setFailed(true);
      },
    }),
    [resolvedTheme],
  );
  if (failed) {
    // Show the hunks without the patch's file headers.
    const hunks = props.patch.slice(Math.max(props.patch.indexOf("\n@@"), 0)).trim();
    return <pre className="whitespace-pre-wrap break-words font-mono">{hunks}</pre>;
  }
  return (
    <DiffWorkerPoolProvider>
      <div aria-label="Edit diff" className="overflow-hidden rounded-md border">
        {props.files.map((file) => (
          <FileDiff key={file.name} fileDiff={file} options={options} />
        ))}
      </div>
    </DiffWorkerPoolProvider>
  );
}
