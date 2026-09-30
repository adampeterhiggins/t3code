import type { ThreadPullRequestSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  evaluatePullRequestWatch,
  pullRequestWatchProblemKeys,
  pullRequestWatchStatusLabel,
} from "./pullRequestWatch.ts";

const snapshot: ThreadPullRequestSnapshot = {
  state: "open",
  title: "Work",
  headBranch: "feature",
  baseBranch: "main",
  isDraft: false,
  updatedAt: "2026-09-30T12:00:00.000Z",
  syncedAt: "2026-09-30T12:00:00.000Z",
};
const active = { status: "active" as const, attemptsUsed: 0, handled: [] };

describe("evaluatePullRequestWatch", () => {
  it("asks for a follow-up covering every problem the host reports", () => {
    const evaluation = evaluatePullRequestWatch(active, {
      ...snapshot,
      checksState: "failing",
      reviewDecision: "changes-requested",
      mergeability: "conflicting",
    });
    expect(evaluation).toMatchObject({
      kind: "follow-up",
      problems: ["checks", "review", "conflict"],
    });
    expect(pullRequestWatchStatusLabel(evaluation, false)).toBe(
      "Starting a follow-up for failing checks, requested changes and merge conflicts",
    );
  });

  it("re-arms failing checks when the pull request is updated", () => {
    const failing = { ...snapshot, checksState: "failing" as const };
    const handled = pullRequestWatchProblemKeys(failing);
    expect(evaluatePullRequestWatch({ ...active, handled }, failing).kind).toBe("handled");
    expect(
      evaluatePullRequestWatch(
        { ...active, handled },
        { ...failing, updatedAt: "2026-09-30T12:05:00.000Z" },
      ).kind,
    ).toBe("follow-up");
  });

  it("does not re-arm requested changes until the review decision clears", () => {
    const reviewed = { ...snapshot, reviewDecision: "changes-requested" as const };
    const watch = { ...active, handled: pullRequestWatchProblemKeys(reviewed) };
    expect(
      evaluatePullRequestWatch(watch, { ...reviewed, updatedAt: "2026-09-30T12:05:00.000Z" }).kind,
    ).toBe("handled");
    expect(
      evaluatePullRequestWatch(watch, { ...reviewed, reviewDecision: "review-required" }),
    ).toEqual({ kind: "waiting", on: "review" });
  });

  it("forgets handled problems that cleared, so they wake the agent if they return", () => {
    const evaluation = evaluatePullRequestWatch(
      { ...active, handled: ["review", "conflict"] },
      { ...snapshot, mergeability: "conflicting" },
    );
    expect(evaluation).toMatchObject({ kind: "handled", handled: ["conflict"] });
  });

  it("stops asking once the budget is spent", () => {
    expect(
      evaluatePullRequestWatch(
        { ...active, attemptsUsed: 3 },
        { ...snapshot, checksState: "failing" },
      ).kind,
    ).toBe("exhausted");
  });

  it("ends with the pull request", () => {
    expect(evaluatePullRequestWatch(active, { ...snapshot, state: "closed" }).kind).toBe("done");
  });
});
