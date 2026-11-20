import {
  parseDevinReviewUrl,
  type DevinReviewFinding,
  type DevinReviewSeverity,
  type DevinReviewStatus,
  type DevinReviewSummary,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

type DevinReviewBadgeVariant = "info" | "success" | "error" | "warning" | "outline";

const STATUS_PRESENTATION: Record<
  DevinReviewStatus,
  { readonly label: string; readonly variant: DevinReviewBadgeVariant }
> = {
  pending: { label: msg("Queued", { $context: "Devin review status" }), variant: "info" },
  running: { label: msg("Reviewing", { $context: "Devin review status" }), variant: "info" },
  completed: { label: msg("Reviewed", { $context: "Devin review status" }), variant: "success" },
  errored: { label: msg("Failed", { $context: "Devin review status" }), variant: "error" },
  cancelled: { label: msg("Cancelled", { $context: "Devin review status" }), variant: "outline" },
  skipped: { label: msg("Skipped", { $context: "Devin review status" }), variant: "outline" },
  none: { label: msg("Not reviewed"), variant: "outline" },
  unknown: { label: msg("Status unavailable"), variant: "outline" },
};

/** Devin's status is for the head commit, so findings with no status mean commits since. */
export function devinReviewStatusPresentation(
  review: Pick<DevinReviewSummary, "status" | "findingCount">,
  resolve: MessageResolver = m,
): { readonly label: string; readonly variant: DevinReviewBadgeVariant } {
  if (review.status === "none" && review.findingCount > 0) {
    return { label: resolve(msg("New commits since review")), variant: "warning" };
  }
  const presentation = STATUS_PRESENTATION[review.status];
  return { label: resolve(presentation.label), variant: presentation.variant };
}

/** A review in flight, so Run review would only queue a duplicate. */
export function isDevinReviewInFlight(status: DevinReviewStatus): boolean {
  return status === "pending" || status === "running";
}

export function devinReviewFindingCountLabel(
  open: number,
  total: number,
  resolve: MessageResolver = m,
): string {
  if (total === 0) return resolve(msg("No findings"));
  if (open === 0) {
    return resolve(
      msg(
        "{count, plural, one {{count} finding, resolved} other {{count} findings, all resolved}}",
      ),
      { count: total },
    );
  }
  return resolve(msg("{count, plural, one {{count} open finding} other {{count} open findings}}"), {
    count: open,
  });
}

/** `src/a.ts:12–14`, `src/a.ts:12`, `src/a.ts`, or null for a comment on the whole change. */
export function devinFindingLocation(
  finding: Pick<DevinReviewFinding, "path" | "startLine" | "endLine">,
): string | null {
  if (finding.path === null) return null;
  const start = finding.startLine ?? finding.endLine;
  if (start === null) return finding.path;
  const end = finding.endLine ?? start;
  return end > start ? `${finding.path}:${start}–${end}` : `${finding.path}:${start}`;
}

const SEVERITY_ORDER: Record<DevinReviewSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export const DEVIN_SEVERITY_LABELS: Record<DevinReviewSeverity, string> = {
  high: msg("High", { $context: "finding severity" }),
  medium: msg("Medium", { $context: "finding severity" }),
  low: msg("Low", { $context: "finding severity" }),
  info: msg("Info", { $context: "finding severity" }),
};

export const DEVIN_SEVERITY_VARIANTS: Record<DevinReviewSeverity, DevinReviewBadgeVariant> = {
  high: "error",
  medium: "warning",
  low: "info",
  info: "outline",
};

/** GitHub resolved or outdated the comment, or Devin itself dismissed or resolved the finding. */
function isDevinFindingClosed(
  finding: Pick<DevinReviewFinding, "resolved" | "outdated" | "devinState">,
): boolean {
  return (
    finding.resolved ||
    finding.outdated ||
    finding.devinState === "dismissed" ||
    finding.devinState === "resolved"
  );
}

/**
 * Open findings first, most severe first; closed findings after, since they no longer need
 * attention. Ties keep Devin's order.
 */
export function partitionDevinFindings(findings: ReadonlyArray<DevinReviewFinding>): {
  readonly open: ReadonlyArray<DevinReviewFinding>;
  readonly closed: ReadonlyArray<DevinReviewFinding>;
} {
  const bySeverity = (a: DevinReviewFinding, b: DevinReviewFinding) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  const open = findings.filter((finding) => !isDevinFindingClosed(finding));
  const closed = findings.filter(isDevinFindingClosed);
  return { open: open.toSorted(bySeverity), closed: closed.toSorted(bySeverity) };
}

/** A finding sent to an agent as message text, with enough to locate it. */
export function devinFindingPrompt(
  finding: DevinReviewFinding,
  review: { readonly repository: string; readonly number: number },
): string {
  const location = devinFindingLocation(finding);
  return [
    `Devin Review finding on ${review.repository}#${review.number} (${finding.severity} severity): ${finding.title}`,
    location === null ? null : `Location: ${location}`,
    `Comment: ${finding.url}`,
    "",
    finding.body.trim(),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** The badge for a finding's state, GitHub's first, then Devin's when it differs from open. */
export function devinFindingStateLabel(
  finding: Pick<DevinReviewFinding, "resolved" | "outdated" | "devinState">,
  resolve: MessageResolver = m,
): string | null {
  if (finding.resolved) return resolve(msg("Resolved", { $context: "review comment state" }));
  if (finding.outdated) return resolve(msg("Outdated", { $context: "review comment state" }));
  if (finding.devinState === "dismissed") return resolve(msg("Dismissed by Devin"));
  if (finding.devinState === "resolved") return resolve(msg("Resolved by Devin"));
  return null;
}

/**
 * Devin's suggested fix as a task for the thread's agent, with a reference line so the agent can
 * find the finding. Null when Devin suggested no fix.
 */
export function devinFindingFixPrompt(
  finding: DevinReviewFinding,
  review: { readonly repository: string; readonly number: number },
): string | null {
  const fix = finding.suggestedFixPrompt?.trim();
  if (!fix) return null;
  const location = devinFindingLocation(finding);
  const where = location === null ? "" : ` at ${location}`;
  return [
    fix,
    "",
    `Devin Review finding on ${review.repository}#${review.number}: ${finding.title}${where} (${finding.url})`,
  ].join("\n");
}

const RUN_KIND_LABELS = {
  full: msg("Full review"),
  incremental: msg("Incremental", { $context: "Devin review run kind" }),
} as const;

/** `Full review · completed · abc1234`, one line of a review's run history. */
export function devinReviewRunLabel(
  run: {
    readonly kind: "full" | "incremental";
    readonly status: string;
    readonly commitSha: string;
  },
  resolve: MessageResolver = m,
): string {
  // Devin's own run status, which it can add to; shown as Devin writes it.
  const status = run.status.trim().toLowerCase().replaceAll("_", " ");
  return [
    resolve(RUN_KIND_LABELS[run.kind]),
    status.length > 0 ? status : null,
    run.commitSha.slice(0, 7),
  ]
    .filter((part) => part !== null && part.length > 0)
    .join(" · ");
}

/** `owner/repo#12 · Reviewed · 2 open findings`, the header of a review chip's preview. */
export function devinReviewChipSummary(
  record: {
    readonly repository: string;
    readonly number: number;
    readonly status: DevinReviewStatus;
    readonly openFindingCount: number;
  },
  resolve: MessageResolver = m,
): string {
  const findings =
    record.openFindingCount === 0
      ? resolve(msg("No open findings"))
      : resolve(msg("{count, plural, one {{count} open finding} other {{count} open findings}}"), {
          count: record.openFindingCount,
        });
  const status = resolve(STATUS_PRESENTATION[record.status].label);
  return `${record.repository}#${record.number} · ${status} · ${findings}`;
}

export type DevinReviewInvolvement = "all" | "authored" | "reviewing";

export function isDevinReviewInvolvement(value: unknown): value is DevinReviewInvolvement {
  return value === "all" || value === "authored" || value === "reviewing";
}

const INVOLVEMENT_STORAGE_KEY = "t3.devinReviews.involvement";

/** The involvement filter last used on this client. Storage can be missing or throw. */
export function readDevinReviewInvolvement(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): DevinReviewInvolvement {
  try {
    const stored = storage?.getItem(INVOLVEMENT_STORAGE_KEY);
    return isDevinReviewInvolvement(stored) ? stored : "all";
  } catch {
    return "all";
  }
}

export function writeDevinReviewInvolvement(
  involvement: DevinReviewInvolvement,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(INVOLVEMENT_STORAGE_KEY, involvement);
  } catch {
    // A private window can refuse storage; the filter still applies for this visit.
  }
}

interface RepositoryProject {
  readonly environmentId: string;
  readonly repositoryIdentity?:
    | {
        readonly owner?: string | undefined;
        readonly name?: string | undefined;
        readonly canonicalKey?: string | undefined;
      }
    | null
    | undefined;
}

/**
 * The project a review's pull request belongs to, preferring one in `environmentId`. Matches
 * the GitHub `owner/repo` case-insensitively, as GitHub does.
 */
export function projectForDevinReview<T extends RepositoryProject>(
  projects: ReadonlyArray<T>,
  repository: string,
  environmentId: string | null,
): T | null {
  const key = repository.toLowerCase();
  const matches = projects.filter((project) => {
    const identity = project.repositoryIdentity;
    if (identity?.owner && identity.name) {
      return `${identity.owner}/${identity.name}`.toLowerCase() === key;
    }
    // `github.com/owner/repo`, for identities read before owner and name were recorded.
    return identity?.canonicalKey?.toLowerCase() === `github.com/${key}`;
  });
  return matches.find((project) => project.environmentId === environmentId) ?? matches[0] ?? null;
}

/** What a failed list or review read means for the reader, from the server's error reason. */
export function devinReviewErrorCopy(
  failure: unknown,
  fallback: string | null,
  resolve: MessageResolver = m,
): string {
  const reason =
    typeof failure === "object" && failure !== null && "reason" in failure ? failure.reason : null;
  switch (reason) {
    case "github":
      return resolve(
        msg(
          "Couldn't read pull requests from GitHub. Sign in to the GitHub CLI on this environment ({command}), then refresh.",
        ),
        { command: "gh auth login" },
      );
    case "revoked":
      return resolve(
        msg("Devin rejected T3 Code's login. Sign in again in Settings → Integrations."),
      );
    case "forbidden":
      return resolve(
        msg(
          "Devin refused the request. Your Devin account or key needs Devin Review permissions in this organization.",
        ),
      );
    case "rate-limited":
      return resolve(msg("Devin or GitHub is rate limiting requests. Try again in a minute."));
    case "not-found":
      return resolve(msg("That pull request or review wasn't found."));
    default:
      return fallback ?? resolve(msg("Couldn't read Devin reviews."));
  }
}

/** The pull requests Devin Review can read: GitHub ones. */
export function devinReviewablePullRequests<T extends { readonly url: string }>(
  links: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return links.filter((link) => parseDevinReviewUrl(link.url, { acceptGitHub: true }) !== null);
}

/** Matches a summary to a linked pull request; GitHub compares `owner/repo` case-insensitively. */
export function devinReviewSummaryKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`;
}

/** Devin reviewed the pull request or left findings on it; otherwise a row stays quiet. */
export function devinReviewSummaryHasNews(
  summary: Pick<DevinReviewSummary, "status" | "findingCount">,
): boolean {
  return summary.findingCount > 0 || (summary.status !== "none" && summary.status !== "unknown");
}
