import type {
  OrchestrationV2Notification,
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail,
  PullRequestReviewDecision,
  ThreadPullRequestWatch,
} from "@t3tools/contracts";
import { PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT } from "@t3tools/shared/pullRequestWatch";

/**
 * Wakes in a row that bring only comments. Check, conflict, or push news resets the count, so
 * this only stops a chatty bot looping an agent that is replying to it.
 */
export const PULL_REQUEST_WATCH_WAKE_LIMIT = 10;
const LISTED_ITEMS = 10;
const SNIPPET_LENGTH = 200;

export type PullRequestWatchChange =
  | { readonly kind: "checks-failed"; readonly failed: ReadonlyArray<PullRequestCheck> }
  | { readonly kind: "checks-passed"; readonly count: number; readonly required: boolean }
  | { readonly kind: "remarks"; readonly remarks: ReadonlyArray<PullRequestComment> }
  | { readonly kind: "conflicting" }
  /** Fork: the review decision became "changes requested". */
  | { readonly kind: "changes-requested" };

/** Fork: changes that ask the agent to fix something, which spend the follow-up budget. */
const isFollowUp = (change: PullRequestWatchChange) =>
  change.kind === "checks-failed" ||
  change.kind === "conflicting" ||
  change.kind === "changes-requested";

export interface PullRequestWatchReport {
  /** What the agent has not been told yet. Empty means no wake. */
  readonly changes: ReadonlyArray<PullRequestWatchChange>;
  /** The watch to record, whether or not anything is reported. */
  readonly next: ThreadPullRequestWatch;
  /** This report spends the last wake before the limit, so watching stops after it. */
  readonly exhausted: boolean;
  /**
   * Fork: which follow-up of the budget this wake is, when it asks for a fix. Null for news
   * only. When the budget is already spent, nothing is reported and `next` pauses the watch,
   * keeping what the agent was last told so resuming reports the news.
   */
  readonly followUp: number | null;
}

// "action-required" is a finished check that needs someone, so the agent hears about it.
const isFailedCheck = (check: PullRequestCheck) =>
  check.status === "failure" || check.status === "cancelled" || check.status === "action-required";

/**
 * Compares a watched pull request with what its agent was last told. Each check is reported as
 * soon as it fails, so a check that never finishes (an advisory review bot) cannot hold the
 * news back. "Passed" is reported once the checks the base branch requires all passed, or all
 * checks where the host marks none required. Remarks count when someone other than the agent's
 * own account wrote them, so its own replies never wake it. `remarks` is null when the
 * conversation could not be read; remarks then wait for a later pass.
 */
export function evaluatePullRequestWatch(
  watch: ThreadPullRequestWatch,
  detail: Pick<PullRequestDetail, "headSha" | "checks" | "mergeability" | "viewer" | "author"> & {
    /** From the synced snapshot: the detail read carries no review decision. */
    readonly reviewDecision?: PullRequestReviewDecision | null | undefined;
  },
  remarks: ReadonlyArray<PullRequestComment> | null,
): PullRequestWatchReport {
  const changes: Array<PullRequestWatchChange> = [];
  const headSha = detail.headSha ?? null;
  const headMoved = headSha !== watch.headSha;

  // An empty list keeps the last state: a host can answer with one when its check read fails.
  let failedChecks = headMoved ? [] : watch.failedChecks;
  let passed = headMoved ? false : watch.passed;
  if (detail.checks.length > 0) {
    const failed = detail.checks.filter(isFailedCheck);
    const newlyFailed = failed.filter((check) => !failedChecks.includes(check.name));
    if (newlyFailed.length > 0) changes.push({ kind: "checks-failed", failed: newlyFailed });
    // A check that runs again leaves the list, so a rerun that fails again is reported.
    failedChecks = failed.map((check) => check.name);

    const required = detail.checks.filter((check) => check.required === true);
    const gate = required.length > 0 ? required : detail.checks;
    const passedNow = gate.every((check) => check.status !== "pending" && !isFailedCheck(check));
    if (passedNow && !passed) {
      changes.push({ kind: "checks-passed", count: gate.length, required: required.length > 0 });
    }
    passed = passedNow;
  }

  const own = (detail.viewer ?? detail.author?.login)?.toLowerCase();
  const through = Date.parse(watch.remarksThrough);
  // GitHub times are per second, so remarks at the boundary time are told apart by ID.
  const fresh = (remarks ?? []).filter((remark) => {
    const at = Date.parse(remark.createdAt);
    return (
      (at > through || (at === through && !watch.remarkIds.includes(remark.id))) &&
      remark.author?.login.toLowerCase() !== own
    );
  });
  if (fresh.length > 0) changes.push({ kind: "remarks", remarks: fresh });
  const latest = Math.max(through, ...fresh.map((remark) => Date.parse(remark.createdAt)));
  const atLatest = fresh.filter((remark) => Date.parse(remark.createdAt) === latest);
  const remarksThrough = latest === through ? watch.remarksThrough : atLatest[0]!.createdAt;
  const remarkIds = [
    ...(latest === through ? watch.remarkIds : []),
    ...atLatest.map((remark) => remark.id),
  ];

  if (detail.mergeability === "conflicting" && !watch.conflicting) {
    changes.push({ kind: "conflicting" });
  }
  // "unknown" is GitHub still computing after a push; only a clean answer clears a conflict.
  const conflicting =
    detail.mergeability === "unknown" ? watch.conflicting : detail.mergeability === "conflicting";

  // Like a conflict, requested changes are reported once and re-arm when the decision clears.
  const changesRequested = detail.reviewDecision === "changes-requested";
  if (changesRequested && watch.changesRequested !== true) {
    changes.push({ kind: "changes-requested" });
  }

  const followUps = watch.followUps ?? 0;
  const asksForFix = changes.some(isFollowUp);
  if (asksForFix && followUps >= PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT) {
    return { changes: [], next: { ...watch, paused: true }, exhausted: false, followUp: null };
  }

  const commentsOnly = changes.length > 0 && changes.every((change) => change.kind === "remarks");
  const progress = headMoved || (changes.length > 0 && !commentsOnly);
  const wakes = (progress ? 0 : watch.wakes) + (commentsOnly ? 1 : 0);
  return {
    changes,
    next: {
      startedAt: watch.startedAt,
      headSha,
      failedChecks,
      passed,
      remarksThrough,
      remarkIds,
      conflicting,
      wakes,
      changesRequested,
      followUps: followUps + (asksForFix ? 1 : 0),
      ...(watch.paused === undefined ? {} : { paused: watch.paused }),
    },
    exhausted: commentsOnly && wakes >= PULL_REQUEST_WATCH_WAKE_LIMIT,
    followUp: asksForFix ? followUps + 1 : null,
  };
}

function snippet(body: string): string {
  const text = body
    .replaceAll(/<!--[\s\S]*?-->/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return text.length <= SNIPPET_LENGTH ? text : `${text.slice(0, SNIPPET_LENGTH - 3)}...`;
}

function listed<T>(items: ReadonlyArray<T>, line: (item: T) => string): Array<string> {
  const lines = items.slice(0, LISTED_ITEMS).map(line);
  if (items.length > LISTED_ITEMS) lines.push(`  - and ${items.length - LISTED_ITEMS} more`);
  return lines;
}

function changeLines(
  change: PullRequestWatchChange,
  context: { readonly baseBranch: string; readonly commit: string },
): Array<string> {
  switch (change.kind) {
    case "checks-failed":
      return [
        `- Checks failed${context.commit}:`,
        ...listed(
          change.failed,
          (check) =>
            `  - ${check.name}${check.status === "failure" ? "" : ` (${check.status})`}${check.url ? ` ${check.url}` : ""}`,
        ),
      ];
    case "checks-passed":
      return [
        `- All ${change.count} ${change.required ? "required " : ""}${change.count === 1 ? "check" : "checks"} passed${context.commit}.`,
      ];
    case "remarks":
      return [
        `- ${change.remarks.length} new ${change.remarks.length === 1 ? "comment" : "comments"}:`,
        ...listed(change.remarks, (remark) => {
          const where = remark.path === null ? "" : ` on ${remark.path}`;
          const body = snippet(remark.body);
          const said = body.length === 0 ? (remark.reviewState ?? "reviewed") : `"${body}"`;
          return `  - ${remark.author?.login ?? "someone"}${where}: ${said}${remark.url ? ` ${remark.url}` : ""}`;
        }),
      ];
    case "conflicting":
      return [`- The branch now conflicts with ${context.baseBranch}.`];
    case "changes-requested":
      return ["- A reviewer requested changes."];
  }
}

/** Fork: what the agent should do about each change that asks for a fix. */
function fixLine(
  change: PullRequestWatchChange,
  context: { readonly baseBranch: string },
): string | null {
  switch (change.kind) {
    case "checks-failed":
      return "- Failing checks: read the failing logs, fix the cause, and push.";
    case "changes-requested":
      return "- Requested changes: read the review comments, address them, push, and reply where useful.";
    case "conflicting":
      return `- Merge conflict: rebase on or merge ${context.baseBranch}, resolve the conflicts, and push.`;
    default:
      return null;
  }
}

function inspectHint(host: string, number: number): string {
  return host === "github.com"
    ? `\`gh pr view ${number} --comments\` and \`gh pr checks ${number}\``
    : "the host's CLI or API";
}

const SUMMARY: Record<PullRequestWatchChange["kind"], string> = {
  "checks-failed": "checks failed",
  "checks-passed": "checks passed",
  remarks: "new comments",
  conflicting: "merge conflict",
  "changes-requested": "changes requested",
};

/** The wake the agent reads and the timeline notification the user sees. */
export function pullRequestWatchMessage(input: {
  readonly host: string;
  readonly number: number;
  readonly url: string;
  readonly baseBranch: string;
  readonly headSha: string | null;
  readonly report: PullRequestWatchReport;
}): { readonly text: string; readonly notification: OrchestrationV2Notification } {
  const { changes, exhausted, followUp } = input.report;
  const context = {
    baseBranch: input.baseBranch,
    commit: input.headSha === null ? "" : ` on ${input.headSha.slice(0, 7)}`,
  };
  const fixes = changes.flatMap((change) => fixLine(change, context) ?? []);
  const text = [
    `Update on pull request #${input.number} (${input.url}), which T3 Code is watching for you:`,
    ...changes.flatMap((change) => changeLines(change, context)),
    "",
    ...(followUp === null || fixes.length === 0
      ? []
      : [
          "Fix these:",
          ...fixes,
          "",
          `Inspect the pull request with ${inspectHint(input.host, input.number)}. If something needs a human decision, stop and say so instead of guessing.`,
          `This is automatic follow-up ${followUp} of ${PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT}; after that T3 Code pauses the watch until the user resumes it.`,
          "",
        ]),
    exhausted
      ? `T3 Code stopped watching after ${PULL_REQUEST_WATCH_WAKE_LIMIT} comment-only updates in a row. Call watch_pull_request to watch it again.`
      : "Look into each item and act on it as your task requires. T3 Code keeps watching and wakes you on the next change, so end your turn when you are done. Call unwatch_pull_request when you no longer need updates.",
  ].join("\n");
  const failed = changes.some(
    (change) => change.kind === "checks-failed" || change.kind === "conflicting",
  );
  const summary = changes.map((change) => SUMMARY[change.kind]);
  if (exhausted) summary.push("stopped watching");
  return {
    text,
    notification: {
      source: { kind: "monitor" },
      outcome: failed
        ? "failed"
        : changes.every((change) => change.kind === "checks-passed")
          ? "completed"
          : "updated",
      summary: `#${input.number}: ${summary.join(", ")}`,
    },
  };
}
