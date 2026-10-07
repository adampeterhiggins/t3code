import { useAtomValue } from "@effect/atom-react";
import { resolveToolPath, toolPathTextParts } from "@t3tools/client-runtime/work-log/tool-paths";
import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { toolPathRootsAtom } from "~/state/toolPaths";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

/** A hoverable copy tooltip, also opened by click, keyboard, and touch. */
function ToolPathBreadcrumb({ path }: { path: NonNullable<ReturnType<typeof resolveToolPath>> }) {
  const [error, setError] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "full file path",
    onCopy: () => setError(null),
    onError: () => setError("Could not copy path. Select it to copy manually."),
  });
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
            className="inline max-w-full cursor-pointer rounded-sm text-left font-mono text-2xs leading-relaxed wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
          />
        }
      >
        <span className="underline decoration-muted-foreground/60 decoration-dotted underline-offset-2">
          {path.rootLabel}
        </span>
        {path.segments.map((segment) => `/${segment}`).join("")}
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
}) {
  const roots = useAtomValue(toolPathRootsAtom(props.environmentId));
  const path = props.pathOnly ? resolveToolPath(props.text, props.workspaceRoot, roots) : null;
  if (path) return <ToolPathBreadcrumb path={path} />;
  const occurrences = new Map<string, number>();
  return toolPathTextParts(props.text, props.workspaceRoot, roots, props.targets).map((part) => {
    if ("text" in part) return part.text;
    const occurrence = (occurrences.get(part.path.absolutePath) ?? 0) + 1;
    occurrences.set(part.path.absolutePath, occurrence);
    return <ToolPathBreadcrumb key={`${part.path.absolutePath}:${occurrence}`} path={part.path} />;
  });
}
