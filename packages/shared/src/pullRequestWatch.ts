import type { ThreadPullRequestSnapshot, ThreadPullRequestWatch } from "@t3tools/contracts";

/** Follow-up wakes (asking for a fix) a watch may spend before it pauses until resumed. */
export const PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT = 3;

/** The watch paused itself because its follow-up budget ran out. */
export function pullRequestWatchExhausted(watch: ThreadPullRequestWatch): boolean {
  return watch.paused === true && (watch.followUps ?? 0) >= PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT;
}

/**
 * One line saying what a watch is waiting on, for clients. Read from the watch and the linked
 * pull request's synced snapshot, so it never claims more than the host last said.
 */
export function pullRequestWatchStatusLabel(
  watch: ThreadPullRequestWatch,
  snapshot: ThreadPullRequestSnapshot | null,
): string {
  if (pullRequestWatchExhausted(watch)) {
    return `Used all ${PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT} follow-ups; resume to allow more`;
  }
  if (watch.paused === true) return "Paused";
  if (snapshot === null) return "Waiting for the first sync";
  if (snapshot.state !== "open") return "Finished";
  const problems = [
    snapshot.checksState === "failing" ? "Checks failed" : null,
    snapshot.reviewDecision === "changes-requested" ? "Changes requested" : null,
    snapshot.mergeability === "conflicting" ? "Merge conflicts" : null,
  ].filter((problem) => problem !== null);
  if (problems.length > 0) return problems.join(" · ");
  if (snapshot.checksState === "pending") return "Waiting for checks";
  if (snapshot.reviewDecision === "review-required") return "Waiting for review";
  return "Nothing to fix";
}
