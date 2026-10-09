import {
  WorktreeInventoryListError,
  type ManagedWorktree,
  type ManagedWorktreePullRequest,
  type ManagedWorktreeState,
  type ManagedWorktreeThread,
  type OrchestrationV2ThreadShell,
  type WorktreeInventoryListResult,
  type WorktreeInventoryRemoveInput,
  type WorktreeInventoryRemoveResult,
  type WorktreeInventorySizeResult,
  type WorktreeRemoveOutcome,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { threadHasQueuedTurnStart } from "../orchestration-v2/ThreadSettlementService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { isFilesystemRoot, managedWorktreesDirectories } from "../worktreesDirectory.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";

/**
 * The worktrees T3 keeps under `<worktree folder>/<repository>/<branch>`: what
 * uses each one, and safe removal. Settings → Storage and the
 * environment RPCs call it.
 */
export class WorktreeInventory extends Context.Service<
  WorktreeInventory,
  {
    readonly list: Effect.Effect<WorktreeInventoryListResult, WorktreeInventoryListError>;
    /** Measured on demand with `du`, a few at a time, so listing never waits on it. */
    readonly size: (path: string) => Effect.Effect<WorktreeInventorySizeResult>;
    /**
     * `git worktree remove` for each path, keeping its branch. Refuses a
     * worktree with uncommitted changes or a running thread.
     */
    readonly remove: (
      input: WorktreeInventoryRemoveInput,
    ) => Effect.Effect<WorktreeInventoryRemoveResult, WorktreeInventoryListError>;
  }
>()("t3/git/WorktreeInventory") {}

const SETTLED_STATUSES = new Set<OrchestrationV2ThreadShell["status"]>([
  "idle",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/** Whether removing the thread's checkout now would pull it out from under work in flight. */
function worktreeThreadRunning(thread: OrchestrationV2ThreadShell, now: number): boolean {
  return (
    thread.activeRunId !== null ||
    !SETTLED_STATUSES.has(thread.status) ||
    thread.pendingRuntimeRequest !== null ||
    (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
    threadHasQueuedTurnStart(thread, now)
  );
}

function threadState(thread: OrchestrationV2ThreadShell): ManagedWorktreeThread["state"] {
  if (thread.archivedAt !== null) return "archived";
  return thread.settledAt !== null ? "settled" : "active";
}

const STATE_RANK: Record<ManagedWorktreeState, number> = {
  active: 3,
  settled: 2,
  archived: 1,
  none: 0,
};

function worktreeState(threads: ReadonlyArray<ManagedWorktreeThread>): ManagedWorktreeState {
  let state: ManagedWorktreeState = "none";
  for (const thread of threads) {
    if (STATE_RANK[thread.state] > STATE_RANK[state]) state = thread.state;
  }
  return state;
}

/** The pull request synced for this branch, else the one a thread names. */
function worktreePullRequest(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  branch: string | null,
): ManagedWorktreePullRequest | null {
  const links = threads.flatMap((thread) =>
    (thread.pullRequests ?? []).filter((link) => link.source !== "stack-dismissed"),
  );
  const synced =
    links.find((link) => link.snapshot !== null && link.snapshot.headBranch === branch) ??
    links.find((link) => link.snapshot !== null);
  if (synced !== undefined)
    return { number: synced.number, url: synced.url, state: synced.snapshot?.state ?? null };
  for (const thread of threads) {
    const named = thread.branchPullRequest ?? thread.linkedPullRequest ?? null;
    if (named !== null) return { number: named.number, url: named.url, state: null };
  }
  return null;
}

const SIZE_TIMEOUT = "5 minutes";

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sizePermits = yield* Semaphore.make(2);

  const realPathOrNull = (target: string) =>
    fs.realPath(target).pipe(Effect.orElseSucceed(() => null));

  /** Canonical worktree folders that exist on this machine. */
  const roots = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => null));
    const directories = managedWorktreesDirectories(
      settings ?? { worktreesDirectory: "", previousWorktreesDirectories: [] },
      config.worktreesDir,
      path,
    );
    const result: string[] = [];
    for (const directory of directories) {
      const real = yield* realPathOrNull(directory);
      if (real !== null && !isFilesystemRoot(real, path) && !result.includes(real))
        result.push(real);
    }
    return result;
  });

  const isLinkedWorktree = (target: string) =>
    fs.stat(path.join(target, ".git")).pipe(
      Effect.map((stat) => stat.type === "File"),
      Effect.orElseSucceed(() => false),
    );

  /**
   * The canonical path when `target` is a linked worktree exactly two levels
   * under a worktree folder and is not itself a symlink; otherwise null.
   */
  const managedPath = Effect.fn("WorktreeInventory.managedPath")(function* (
    target: string,
    managedRoots: ReadonlyArray<string>,
  ) {
    const resolved = path.resolve(target);
    const real = yield* realPathOrNull(resolved);
    const realParent = yield* realPathOrNull(path.dirname(resolved));
    if (real === null || realParent === null) return null;
    if (real !== path.join(realParent, path.basename(resolved))) return null;
    const underRoot = managedRoots.some((root) => {
      const relative = path.relative(root, real);
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
      return relative.split(path.sep).length === 2;
    });
    if (!underRoot || !(yield* isLinkedWorktree(real))) return null;
    return real;
  });

  const readThreads = Effect.gen(function* () {
    const active = yield* threadManagement.getShellSnapshot();
    const archived = yield* threadManagement.getShellSnapshot({ location: "archive" });
    const byId = new Map<string, OrchestrationV2ThreadShell>();
    for (const snapshot of [active, archived]) {
      for (const thread of [...snapshot.threads, ...snapshot.archivedThreads]) {
        byId.set(thread.id, thread);
      }
    }
    // Index by both the stored and the canonical path; worktree folders are compared canonically.
    const byPath = new Map<string, OrchestrationV2ThreadShell[]>();
    const add = (key: string, thread: OrchestrationV2ThreadShell) => {
      const entries = byPath.get(key) ?? [];
      if (!entries.includes(thread)) entries.push(thread);
      byPath.set(key, entries);
    };
    for (const thread of byId.values()) {
      if (thread.worktreePath === null) continue;
      const resolved = path.resolve(thread.worktreePath);
      add(resolved, thread);
      const real = yield* realPathOrNull(resolved);
      if (real !== null && real !== resolved) add(real, thread);
    }
    return byPath;
  }).pipe(Effect.mapError((cause) => new WorktreeInventoryListError({ cause })));

  const list = Effect.gen(function* () {
    const managedRoots = yield* roots;
    const candidates: Array<{ path: string; repositoryName: string }> = [];
    for (const root of managedRoots) {
      const repositories = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
      for (const repositoryName of repositories) {
        const entries = yield* fs
          .readDirectory(path.join(root, repositoryName))
          .pipe(Effect.orElseSucceed(() => []));
        for (const entry of entries) {
          const target = path.join(root, repositoryName, entry);
          const managed = yield* managedPath(target, managedRoots);
          if (managed !== null && !candidates.some((candidate) => candidate.path === managed))
            candidates.push({ path: managed, repositoryName });
        }
      }
    }
    const threadsByPath = yield* readThreads;
    const now = yield* Clock.currentTimeMillis;
    const worktrees = yield* Effect.forEach(
      candidates,
      (candidate) =>
        Effect.gen(function* () {
          const status = yield* git
            .statusDetailsLocal(candidate.path, { includeDivergence: false })
            .pipe(Effect.orElseSucceed(() => null));
          const threads = threadsByPath.get(candidate.path) ?? [];
          const summaries = threads.map((thread): ManagedWorktreeThread => ({
            threadId: thread.id,
            title: thread.title,
            state: threadState(thread),
            running: worktreeThreadRunning(thread, now),
          }));
          const branch = status?.isRepo ? status.branch : (threads[0]?.branch ?? null);
          return {
            path: candidate.path,
            repositoryName: candidate.repositoryName,
            projectId: threads[0]?.projectId ?? null,
            branch,
            dirty: status?.isRepo ? status.hasWorkingTreeChanges : null,
            state: worktreeState(summaries),
            threads: summaries,
            pullRequest: worktreePullRequest(threads, branch),
          } satisfies ManagedWorktree;
        }),
      { concurrency: 6 },
    );
    return { worktrees };
  }).pipe(Effect.withSpan("WorktreeInventory.list"));

  const size: WorktreeInventory["Service"]["size"] = (target) =>
    Effect.gen(function* () {
      const managed = yield* managedPath(target, yield* roots);
      if (managed === null) return { bytes: null };
      const output = yield* sizePermits.withPermit(
        processRunner.run({
          command: "du",
          args: ["-sk", managed],
          timeout: SIZE_TIMEOUT,
          maxOutputBytes: 64 * 1024,
          outputMode: "truncate",
        }),
      );
      // du still prints the total when it could not read some entries.
      const kibibytes = Number.parseInt(output.stdout.trim().split(/\s/)[0] ?? "", 10);
      return { bytes: Number.isFinite(kibibytes) && kibibytes >= 0 ? kibibytes * 1024 : null };
    }).pipe(
      Effect.catch(() => Effect.succeed({ bytes: null })),
      Effect.withSpan("WorktreeInventory.size"),
    );

  const removeOne = Effect.fn("WorktreeInventory.removeOne")(function* (
    target: string,
    managedRoots: ReadonlyArray<string>,
    projectRoots: ReadonlyArray<string>,
  ) {
    const managed = yield* managedPath(target, managedRoots);
    if (managed === null) return "not_managed" as const;
    // A project's own checkout is never a removable worktree, even if it sits in a worktree folder.
    if (
      projectRoots.some((root) => {
        const relative = path.relative(managed, root);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      })
    )
      return "not_managed" as const;
    return yield* withWorkspaceLease(
      managed,
      Effect.gen(function* () {
        // Re-read under the lease: a thread may have started since the list was shown.
        const threads = (yield* readThreads).get(managed) ?? [];
        const now = yield* Clock.currentTimeMillis;
        if (threads.some((thread) => worktreeThreadRunning(thread, now))) return "running" as const;
        const status = yield* git.statusDetailsLocal(managed, { includeDivergence: false });
        if (!status.isRepo) return "not_managed" as const;
        if (status.hasWorkingTreeChanges) return "dirty" as const;
        const commonDir = (yield* git.execute({
          operation: "WorktreeInventory.commonDir",
          cwd: managed,
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        })).stdout.trim();
        const repositoryCwd =
          path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
        // Removal keeps the branch; resuming a thread recreates its checkout from it.
        yield* gitWorkflow.removeWorktree({
          cwd: repositoryCwd,
          path: managed,
          force: false,
        });
        return "removed" as const;
      }),
    );
  });

  const remove: WorktreeInventory["Service"]["remove"] = (input) =>
    Effect.gen(function* () {
      const managedRoots = yield* roots;
      const projectRoots = yield* projects.listShells().pipe(
        Effect.map((shells) => shells.map((shell) => path.resolve(shell.workspaceRoot))),
        Effect.mapError((cause) => new WorktreeInventoryListError({ cause })),
      );
      const canonicalProjectRoots = [...projectRoots];
      for (const root of projectRoots) {
        const real = yield* realPathOrNull(root);
        if (real !== null && real !== root) canonicalProjectRoots.push(real);
      }
      const results = yield* Effect.forEach(
        [...new Set(input.paths)],
        (target) =>
          removeOne(target, managedRoots, canonicalProjectRoots).pipe(
            Effect.catch((error) =>
              Effect.logWarning("worktree removal failed", { error }).pipe(
                Effect.as<WorktreeRemoveOutcome>("failed"),
              ),
            ),
            Effect.map((outcome) => ({ path: target, outcome })),
          ),
        // One at a time: removals are filesystem-bound and share repository locks.
        { concurrency: 1 },
      );
      return { results };
    }).pipe(Effect.withSpan("WorktreeInventory.remove"));

  return WorktreeInventory.of({ list, size, remove });
});

export const layer = Layer.effect(WorktreeInventory, make);
