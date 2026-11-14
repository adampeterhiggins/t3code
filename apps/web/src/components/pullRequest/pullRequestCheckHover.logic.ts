import type { PullRequestCheck } from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "~/timestampFormat";

export function pullRequestCheckHoverDetail(
  check: Pick<PullRequestCheck, "name" | "description">,
): string | null {
  const description = check.description?.trim() ?? "";
  return description.length > 0 && description !== check.name ? description : null;
}

/** Who ran the check, leaving out a workflow the name already leads with. */
export function pullRequestCheckSource(
  check: Pick<PullRequestCheck, "name" | "app" | "workflow">,
): string | null {
  const workflow =
    check.workflow && !check.name.startsWith(`${check.workflow} / `) ? check.workflow : null;
  const parts = [check.app, workflow].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatCheckDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

export function pullRequestCheckTiming(
  check: Pick<PullRequestCheck, "status" | "startedAt" | "completedAt">,
  nowMs: number,
): string | null {
  const startedMs = check.startedAt ? Date.parse(check.startedAt) : Number.NaN;
  const completedMs = check.completedAt ? Date.parse(check.completedAt) : Number.NaN;
  if (check.status === "pending") {
    return Number.isNaN(startedMs) ? null : `Running for ${formatCheckDuration(nowMs - startedMs)}`;
  }
  if (Number.isNaN(completedMs)) return null;
  const finished = `Finished ${formatRelativeTimeLabel(check.completedAt ?? "", nowMs)}`;
  return Number.isNaN(startedMs)
    ? finished
    : `Took ${formatCheckDuration(completedMs - startedMs)} · ${finished.toLowerCase()}`;
}

/** Check summaries are Markdown reports; the preview shows their prose as plain text. */
export function plainCheckSummary(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .filter((line) => !/^\s*\|/.test(line))
    .map((line) =>
      line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/(\*\*|__|`)/g, "")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
