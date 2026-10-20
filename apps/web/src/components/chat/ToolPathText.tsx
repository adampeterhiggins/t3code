import { useAtomValue } from "@effect/atom-react";
import { resolveToolPath, toolPathTextParts } from "@t3tools/client-runtime/work-log/tool-paths";
import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { toolPathRootsAtom } from "~/state/toolPaths";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

const pathRootClassName =
  "underline decoration-muted-foreground/60 decoration-dotted underline-offset-2";

/**
 * Activity rows are one line. The filename stays outside the truncating span so a long
 * directory collapses in the middle (`repo/src/…/File.ts`) instead of wrapping after the verb.
 */
function ToolPathBreadcrumb({
  path,
  singleLine = false,
}: {
  path: NonNullable<ReturnType<typeof resolveToolPath>>;
  singleLine?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "full file path",
    onCopy: () => setError(null),
    onError: () => setError("Could not copy path. Select it to copy manually."),
  });
  const filename = path.segments.at(-1);
  const directories = filename === undefined ? [] : path.segments.slice(0, -1);
  const root = <span className={pathRootClassName}>{path.rootLabel}</span>;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        aria-label={`Full path: ${path.absolutePath}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        render={
          <button
            type="button"
            className={
              singleLine
                ? "inline-flex min-w-0 max-w-full cursor-pointer items-baseline overflow-hidden whitespace-nowrap rounded-sm text-left font-mono text-2xs leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
                : "inline max-w-full cursor-pointer rounded-sm text-left font-mono text-2xs leading-relaxed wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
            }
          />
        }
      >
        {singleLine ? (
          filename === undefined ? (
            <span className="min-w-0 truncate">{root}</span>
          ) : (
            <>
              <span className="min-w-0 truncate">
                {root}
                {directories.length > 0 ? `/${directories.join("/")}` : null}
              </span>
              <span className="shrink-0">/{filename}</span>
            </>
          )
        ) : (
          <>
            {root}
            {path.segments.map((segment) => `/${segment}`).join("")}
          </>
        )}
      </PopoverTrigger>
      <PopoverPopup width="lg" padding="compact" tooltipStyle align="start">
        <div
          className="flex flex-col gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {path.project ? <span className="text-muted-foreground">{path.project}</span> : null}
          <code className="wrap-anywhere font-mono text-xs select-text">{path.absolutePath}</code>
          <div className="self-start">
            <Button
              size="micro"
              variant="ghost-muted"
              onClick={() => copyToClipboard(path.absolutePath, undefined)}
            >
              {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              <span aria-live="polite">{isCopied ? "Copied" : "Copy full path"}</span>
            </Button>
          </div>
          {error ? (
            <span role="alert" className="text-destructive-foreground">
              {error}
            </span>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Shared provider-neutral path tokens, used only for tool headings and file targets. */
export function ToolPathText(props: {
  text: string;
  environmentId: EnvironmentId;
  workspaceRoot: string | null | undefined;
  pathOnly?: boolean;
  targets?: ReadonlyArray<string>;
  /** One line, keeping each file name. Detail and preview views leave this off and wrap. */
  singleLine?: boolean;
}) {
  const roots = useAtomValue(toolPathRootsAtom(props.environmentId));
  const path = props.pathOnly ? resolveToolPath(props.text, props.workspaceRoot, roots) : null;
  if (path) {
    const breadcrumb = <ToolPathBreadcrumb path={path} singleLine={props.singleLine ?? false} />;
    if (!props.singleLine) return breadcrumb;
    return <span className="flex w-full min-w-0 items-baseline">{breadcrumb}</span>;
  }
  const occurrences = new Map<string, number>();
  const nodes = toolPathTextParts(props.text, props.workspaceRoot, roots, props.targets).map(
    (part, index) => {
      if ("text" in part) {
        if (!props.singleLine) return part.text;
        return (
          <span key={`text:${index}`} className="shrink-0 whitespace-pre">
            {part.text}
          </span>
        );
      }
      const occurrence = (occurrences.get(part.path.absolutePath) ?? 0) + 1;
      occurrences.set(part.path.absolutePath, occurrence);
      return (
        <ToolPathBreadcrumb
          key={`${part.path.absolutePath}:${occurrence}`}
          path={part.path}
          singleLine={props.singleLine ?? false}
        />
      );
    },
  );
  if (!props.singleLine) return nodes;
  return <span className="flex w-full min-w-0 items-baseline">{nodes}</span>;
}
