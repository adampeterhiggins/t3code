import type { PullRequestWatch, ThreadPullRequestSnapshot } from "@t3tools/contracts";

/** Follow-up turns a watch may start before the user has to resume it. */
export const PULL_REQUEST_WATCH_MAX_ATTEMPTS = 3;

export type PullRequestWatchProblem = "checks" | "review" | "conflict";

export type PullRequestWatchEvaluation =
  | { readonly kind: "syncing" }
  /** Merged or closed: the watch ends. */
  | { readonly kind: "done" }
  | { readonly kind: "paused" }
  /** Nothing for the agent to do; the host is waiting on something else. */
  | { readonly kind: "waiting"; readonly on: "checks" | "review" | "nothing" }
  /** New work the agent has not been asked about yet. */
  | {
      readonly kind: "follow-up";
      readonly problems: ReadonlyArray<PullRequestWatchProblem>;
      readonly handled: ReadonlyArray<string>;
    }
  | { readonly kind: "exhausted"; readonly problems: ReadonlyArray<PullRequestWatchProblem> }
  /** The agent was already asked about everything still wrong; waits for the host to change. */
  | {
      readonly kind: "handled";
      readonly problems: ReadonlyArray<PullRequestWatchProblem>;
      readonly handled: ReadonlyArray<string>;
    };

/**
 * Keys for the work an open pull request reports. Failing checks are keyed by the pull request's
 * last update, so a push re-arms them even when no sync saw the checks pending in between.
 * Requested changes and conflicts re-arm only once they clear.
 */
export function pullRequestWatchProblemKeys(
  snapshot: ThreadPullRequestSnapshot,
): ReadonlyArray<string> {
  if (snapshot.state !== "open") return [];
  const keys: Array<string> = [];
  if (snapshot.checksState === "failing") keys.push(`checks@${snapshot.updatedAt ?? ""}`);
  if (snapshot.reviewDecision === "changes-requested") keys.push("review");
  if (snapshot.mergeability === "conflicting") keys.push("conflict");
  return keys;
}

function problemOf(key: string): PullRequestWatchProblem {
  return key.split("@", 1)[0] as PullRequestWatchProblem;
}

export function evaluatePullRequestWatch(
  watch: Pick<PullRequestWatch, "status" | "attemptsUsed" | "handled">,
  snapshot: ThreadPullRequestSnapshot | null,
): PullRequestWatchEvaluation {
  if (snapshot === null) return { kind: "syncing" };
  if (snapshot.state !== "open") return { kind: "done" };
  if (watch.status === "paused") return { kind: "paused" };
  const keys = pullRequestWatchProblemKeys(snapshot);
  if (keys.length === 0) {
    if (snapshot.checksState === "pending") return { kind: "waiting", on: "checks" };
    if (snapshot.reviewDecision === "review-required") return { kind: "waiting", on: "review" };
    return { kind: "waiting", on: "nothing" };
  }
  const problems = keys.map(problemOf);
  if (keys.some((key) => !watch.handled.includes(key))) {
    return watch.attemptsUsed >= PULL_REQUEST_WATCH_MAX_ATTEMPTS
      ? { kind: "exhausted", problems }
      : { kind: "follow-up", problems, handled: keys };
  }
  return { kind: "handled", problems, handled: watch.handled.filter((key) => keys.includes(key)) };
}

const PROBLEM_LABELS: Record<PullRequestWatchProblem, string> = {
  checks: "failing checks",
  review: "requested changes",
  conflict: "merge conflicts",
};

function pullRequestWatchProblemsLabel(problems: ReadonlyArray<PullRequestWatchProblem>): string {
  const labels = problems.map((problem) => PROBLEM_LABELS[problem]);
  return labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** One line saying what a watch is doing, for clients. `busy` means the thread is mid-turn. */
export function pullRequestWatchStatusLabel(
  evaluation: PullRequestWatchEvaluation,
  busy: boolean,
): string {
  switch (evaluation.kind) {
    case "syncing":
      return "Waiting for the first sync";
    case "done":
      return "Finished";
    case "paused":
      return "Paused";
    case "waiting":
      return evaluation.on === "checks"
        ? "Waiting for checks"
        : evaluation.on === "review"
          ? "Waiting for review"
          : "Nothing to fix";
    case "follow-up":
      return busy
        ? `Will fix ${pullRequestWatchProblemsLabel(evaluation.problems)} when the agent is free`
        : `Starting a follow-up for ${pullRequestWatchProblemsLabel(evaluation.problems)}`;
    case "exhausted":
      return `Used all ${PULL_REQUEST_WATCH_MAX_ATTEMPTS} follow-ups; resume to allow more`;
    case "handled":
      return busy
        ? `Agent is fixing ${pullRequestWatchProblemsLabel(evaluation.problems)}`
        : `Follow-up left ${pullRequestWatchProblemsLabel(evaluation.problems)}; waiting for new activity`;
  }
}
