import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { BotIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { TooltipPopup } from "./ui/tooltip";
import { cn } from "~/lib/utils";

export function ThreadHoverCardPopup({ className, ...props }: ComponentProps<typeof TooltipPopup>) {
  return (
    <TooltipPopup
      {...props}
      variant="glass"
      className={cn("max-w-80 text-left whitespace-normal", className)}
    />
  );
}

export function ThreadHoverCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2">
      <div className="min-w-0 truncate text-xs leading-tight font-medium text-foreground">
        {title}
      </div>
      <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">{children}</div>
      {footer}
    </div>
  );
}

/**
 * Built from the thread shell the client already holds, so hovering never fetches history.
 * Orchestration v2 shells omit the latest message, so a missing preview doesn't mean an empty thread.
 */
export function ThreadPreviewHoverCard(props: {
  shell: EnvironmentThreadShell;
  project: EnvironmentProject | null;
  title: string;
}) {
  const { shell, project } = props;
  const preview = shell.source.latestVisibleMessage?.text.trim();
  return (
    <ThreadHoverCard title={props.title}>
      {project ? (
        <div className="flex min-w-0 items-center gap-2">
          <FolderIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{project.title}</span>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <BotIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{shell.modelSelection.model}</span>
        <span className="ml-auto shrink-0 capitalize">
          {shell.source.status.replaceAll("_", " ")}
        </span>
      </div>
      {shell.branch ? (
        <div className="flex min-w-0 items-center gap-2">
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{shell.branch}</span>
        </div>
      ) : null}
      {preview ? (
        <p className="line-clamp-4 border-t border-border/60 pt-2 break-words whitespace-pre-wrap text-foreground/85">
          {preview.slice(0, 600)}
          {preview.length > 600 ? "…" : ""}
        </p>
      ) : null}
    </ThreadHoverCard>
  );
}
