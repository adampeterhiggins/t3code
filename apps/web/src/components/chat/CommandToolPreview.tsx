import { CheckIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { ShellCommandBlock } from "./ShellCommandBlock";

/** A command stays visible; its output is mounted only after opening the disclosure. */
export function CommandToolPreview({
  heading,
  command,
  status,
  timestamp,
  exitCode,
  children,
}: {
  heading: ReactNode;
  command: string;
  status: string | null;
  timestamp: string;
  exitCode: number | undefined;
  children: ReactNode;
}) {
  const [outputOpen, setOutputOpen] = useState(false);
  const failed = status === "failed" || (exitCode !== undefined && exitCode !== 0);
  return (
    <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto p-3">
      <div className="flex items-start justify-between gap-3 text-xs text-secondary-label">
        <div className="flex min-w-0 items-start gap-1.5">{heading}</div>
        {status ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1",
              failed ? "text-destructive" : status === "completed" && "text-success",
            )}
          >
            {status === "completed" && !failed ? (
              <CheckIcon aria-hidden className="size-3" />
            ) : null}
            {status}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text">
        <ShellCommandBlock command={command} />
      </div>
      <details
        className="border-t border-border/70 pt-2"
        onToggle={(event) => setOutputOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs text-secondary-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          View output
          <span
            className={cn(
              "float-right ml-3 font-mono text-3xs select-text",
              failed && "text-destructive",
            )}
          >
            {[exitCode !== undefined ? `exit ${exitCode}` : null, timestamp]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </summary>
        {outputOpen ? <div className="mt-3">{children}</div> : null}
      </details>
    </div>
  );
}
