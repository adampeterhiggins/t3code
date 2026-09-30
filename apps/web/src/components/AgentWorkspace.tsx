/**
 * Where a subagent works: its worktree's folder name, branch, and whether it
 * shares the thread's workspace. The detail header shows one line with a hover
 * card holding the full path; agent rows show just the folder name.
 */
import type {
  RuntimeSubagent,
  SubagentWorkspace,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { CheckIcon, CloudIcon, CopyIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import { useRef } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "./ui/anchoredCopyToast";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";

type LocatedWorkspace = Extract<SubagentWorkspace, { path: string }>;

const WORKSPACE_TAGS = {
  shared: { label: "shared", variant: "secondary" },
  isolated: { label: "isolated", variant: "info" },
  assumed: { label: "thread folder?", variant: "outline" },
} as const;

const WORKSPACE_NOTES: Record<LocatedWorkspace["kind"], string> = {
  shared: "Same folder as the thread. Edits land in its working tree.",
  isolated: "A separate folder from the thread's.",
  assumed: "Assumed. This provider doesn't report where its subagents run.",
};

function CopyValueButton(props: { value: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  return (
    <Button
      ref={ref}
      size="icon-micro"
      variant="ghost-muted"
      aria-label={`Copy ${props.label}`}
      onClick={() => copyToClipboard(props.value, undefined)}
    >
      {isCopied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  );
}

function WorkspaceDetailRow(props: { label: string; value: string }) {
  return (
    <>
      <dt className="pt-0.5 text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-all pt-0.5 font-mono text-2xs">{props.value}</dd>
      <CopyValueButton value={props.value} label={props.label.toLowerCase()} />
    </>
  );
}

function LinesChanged(props: { agent: RuntimeSubagent }) {
  const { linesAdded, linesRemoved } = props.agent;
  if (linesAdded === null && linesRemoved === null) return null;
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-success-foreground">+{linesAdded ?? 0}</span>{" "}
      <span className="text-destructive-foreground">−{linesRemoved ?? 0}</span>
    </span>
  );
}

/** One line under the agent's identity: folder, tag, branch, lines changed. */
export function AgentWorkspaceLine(props: {
  agent: RuntimeSubagent;
  workspace: SubagentWorkspace | null;
}) {
  const { agent, workspace } = props;
  if (!workspace) return null;
  const lineClass =
    "flex min-w-0 items-center gap-1.5 px-1 font-mono text-2xs text-muted-foreground";
  if (workspace.kind === "remote") {
    const sessionUrl = agent.runHandles?.sessionUrl;
    return (
      <p className={lineClass}>
        <CloudIcon aria-hidden className="size-3 shrink-0" />
        <Badge size="sm" variant="info">
          remote
        </Badge>
        {sessionUrl ? (
          <a
            href={sessionUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-info-foreground hover:underline"
          >
            Open session
          </a>
        ) : null}
      </p>
    );
  }
  if (workspace.kind === "pending") {
    return (
      <p className={lineClass}>
        <FolderIcon aria-hidden className="size-3 shrink-0" />
        <Badge size="sm" variant="info">
          isolated
        </Badge>
        <span className="min-w-0 truncate">worktree reported when it finishes</span>
      </p>
    );
  }
  const tag = WORKSPACE_TAGS[workspace.kind];
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={300}
        closeDelay={150}
        render={
          <div
            tabIndex={0}
            className={cn(
              lineClass,
              "cursor-default rounded-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
            )}
          />
        }
      >
        <FolderIcon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 shrink truncate text-secondary-label">{workspace.name}</span>
        <Badge size="sm" variant={tag.variant}>
          {tag.label}
        </Badge>
        {workspace.branch ? (
          <>
            <GitBranchIcon aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{workspace.branch}</span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <LinesChanged agent={agent} />
      </PreviewCardTrigger>
      <PreviewCardPopup side="bottom" align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-1.5 p-2.5 text-xs">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1">
            <WorkspaceDetailRow label="Path" value={workspace.path} />
            {workspace.branch ? (
              <WorkspaceDetailRow label="Branch" value={workspace.branch} />
            ) : null}
          </dl>
          <p className="text-2xs text-muted-foreground">{WORKSPACE_NOTES[workspace.kind]}</p>
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/** Compact folder name for an agent row; the full path is its tooltip. */
export function AgentWorkspaceChip(props: { workspace: SubagentWorkspace | null }) {
  const { workspace } = props;
  if (!workspace) return null;
  if (workspace.kind === "remote" || workspace.kind === "pending") {
    return (
      <span className="flex max-w-32 shrink-0 items-center gap-1 font-mono text-2xs text-info-foreground">
        {workspace.kind === "remote" ? (
          <CloudIcon aria-hidden className="size-3 shrink-0" />
        ) : (
          <FolderIcon aria-hidden className="size-3 shrink-0" />
        )}
        <span className="truncate">{workspace.kind === "remote" ? "remote" : "isolated"}</span>
      </span>
    );
  }
  return (
    <span
      title={workspace.path}
      className={cn(
        "flex max-w-32 shrink-0 items-center gap-1 font-mono text-2xs",
        workspace.kind === "isolated" ? "text-info-foreground" : "text-muted-foreground/80",
      )}
    >
      <FolderIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{workspace.name}</span>
    </span>
  );
}
