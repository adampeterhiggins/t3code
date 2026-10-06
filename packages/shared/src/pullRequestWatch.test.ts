import type { ThreadPullRequestSnapshot, ThreadPullRequestWatch } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT,
  pullRequestWatchStatusLabel,
} from "./pullRequestWatch.ts";

const watch = (overrides: Partial<ThreadPullRequestWatch> = {}): ThreadPullRequestWatch => ({
  startedAt: "2026-10-02T12:00:00.000Z",
  headSha: null,
  failedChecks: [],
  passed: false,
  passedChecks: [],
  remarksThrough: "2026-10-02T12:00:00.000Z",
  remarkIds: [],
  conflicting: false,
  wakes: 0,
  ...overrides,
});

const snapshot = (
  overrides: Partial<ThreadPullRequestSnapshot> = {},
): ThreadPullRequestSnapshot => ({
  title: "Watched",
  state: "open",
  baseBranch: "main",
  headBranch: "feature",
  isDraft: false,
  updatedAt: null,
  syncedAt: "2026-10-02T12:00:00.000Z",
  ...overrides,
});

describe("pullRequestWatchStatusLabel", () => {
  it("names every problem the host reports", () => {
    expect(
      pullRequestWatchStatusLabel(
        watch(),
        snapshot({ checksState: "failing", reviewDecision: "changes-requested" }),
      ),
    ).toBe("Checks failed · Changes requested");
    expect(pullRequestWatchStatusLabel(watch(), snapshot({ mergeability: "conflicting" }))).toBe(
      "Merge conflicts",
    );
  });

  it("says what a healthy pull request waits on", () => {
    expect(pullRequestWatchStatusLabel(watch(), snapshot({ checksState: "pending" }))).toBe(
      "Waiting for checks",
    );
    expect(
      pullRequestWatchStatusLabel(watch(), snapshot({ reviewDecision: "review-required" })),
    ).toBe("Waiting for review");
    expect(pullRequestWatchStatusLabel(watch(), snapshot())).toBe("Nothing to fix");
    expect(pullRequestWatchStatusLabel(watch(), null)).toBe("Waiting for the first sync");
  });

  it("tells a spent budget apart from a pause", () => {
    const failing = snapshot({ checksState: "failing" });
    expect(pullRequestWatchStatusLabel(watch({ paused: true }), failing)).toBe("Paused");
    expect(
      pullRequestWatchStatusLabel(
        watch({ paused: true, followUps: PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT }),
        failing,
      ),
    ).toBe(`Used all ${PULL_REQUEST_WATCH_FOLLOW_UP_LIMIT} follow-ups; resume to allow more`);
  });
});
