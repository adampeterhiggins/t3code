import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  acceptedModelIgnoredNames,
  ignoredPathsBlockWorktreeRemoval,
  storageCleanupActivityAt,
  storageCleanupThreadIdle,
  suggestedIgnoredDirectoryNames,
} from "./storageCleanup.ts";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function at(offsetMs: number): DateTime.Utc {
  return DateTime.makeUnsafe(NOW_MS + offsetMs);
}

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: at(-30 * DAY_MS),
    updatedAt: at(-10 * DAY_MS),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

describe("V2 storage cleanup eligibility", () => {
  const candidate = () => shell({ branch: "feature", worktreePath: "/worktrees/feature" });

  it("allows an idle worktree and rejects the project checkout", () => {
    expect(storageCleanupThreadIdle(candidate(), NOW_MS)).toBe(true);
    expect(storageCleanupThreadIdle(shell(), NOW_MS)).toBe(false);
  });

  it.each(["running", "starting", "preparing", "waiting", "queued"] as const)(
    "retains a worktree while its thread is %s",
    (status) => {
      expect(storageCleanupThreadIdle(candidateWithStatus(status), NOW_MS)).toBe(false);
    },
  );

  it("retains an active run even if the shell status is idle", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), activeRunId: RunId.make("run") }, NOW_MS),
    ).toBe(false);
  });

  it("retains a queued prompt before the new run has been projected", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), latestUserMessageAt: at(-1_000) }, NOW_MS),
    ).toBe(false);
  });

  it("uses V2 run activity instead of metadata refreshes for retention", () => {
    const thread = candidate();
    const runTime = at(-3 * DAY_MS);
    expect(
      storageCleanupActivityAt({ ...thread, latestRunCompletedAt: runTime, updatedAt: at(0) }),
    ).toBe(DateTime.toEpochMillis(runTime));
  });

  function candidateWithStatus(status: OrchestrationV2ThreadShell["status"]) {
    return { ...candidate(), status };
  }
});

describe("ignoredPathsBlockWorktreeRemoval", () => {
  it("allows dependency installs and regenerable caches", () => {
    const stdout = [
      "node_modules/",
      "apps/web/node_modules/",
      ".venv/",
      "services/api/venv/",
      "src/pkg/__pycache__/",
      "src/pkg/__pycache__/mod.pyc",
      "loose.pyc",
      "loose.pyo",
      "tsconfig.tsbuildinfo",
      "pkg.egg-info/",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      ".next/",
      ".turbo/",
      ".DS_Store",
      "nested/.DS_Store",
      "",
    ].join("\0");

    expect(ignoredPathsBlockWorktreeRemoval(stdout, false)).toBe(false);
  });

  it("blocks secrets, local data, and truncated listings", () => {
    expect(ignoredPathsBlockWorktreeRemoval(".env\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval(".cache/\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("data/local.csv\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("dist/\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("target/\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("node_modules/\0.env\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("__pycache__/\0", true)).toBe(true);
  });

  it("suggests ignored directories that are not built-in caches or credential stores", () => {
    expect(
      suggestedIgnoredDirectoryNames(
        [
          "node_modules/\0__pycache__/\0target/\0.env/\0.ssh/\0dist/\0",
          "apps/web/dist/\0target/\0.cache/\0src/pkg.egg-info/\0",
        ],
        50,
      ),
    ).toEqual(["dist", "target"]);
  });

  it("keeps only model names that the project scan found", () => {
    expect(
      acceptedModelIgnoredNames(["target", "dist", ".cache"], ["dist", ".env", "made-up", "dist"]),
    ).toEqual(["dist"]);
  });

  it("allows extra names from settings for files and directories", () => {
    const extra = new Set(["target", "dist"]);
    expect(ignoredPathsBlockWorktreeRemoval("target/\0src/dist\0", false, extra)).toBe(false);
    expect(ignoredPathsBlockWorktreeRemoval("target/\0.env\0", false, extra)).toBe(true);
  });
});
