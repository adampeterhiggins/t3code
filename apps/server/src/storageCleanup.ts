import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2ProviderSessionJson,
  parseWorktreeCleanupIgnoredNames,
  TextGenerationError,
  WORKTREE_CLEANUP_IGNORED_NAME_MAX_COUNT,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type {
  OrchestrationV2ThreadShell,
  OrchestrationV2ThreadShellSnapshot,
  ProjectId,
  ServerSettings,
  ServerSettingsError,
  TerminalSummary,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as ConductorWorkspace from "./project/ConductorWorkspace.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import { threadHasQueuedTurnStart } from "./orchestration-v2/ThreadSettlementService.ts";
import { forkParked } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { resolveWorktreeCleanupModelSelection } from "@t3tools/shared/serverSettings";

import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as TextGeneration from "./textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";

const decodeCleanupThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeCleanupSession = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderSessionJson),
);

const DAY_MS = 86_400_000;
const isTextGenerationError = Schema.is(TextGenerationError);

/**
 * Directory names git may list as ignored that are dependency installs or tool
 * caches. Anything else ignored — secrets, datasets, generic build folders —
 * still blocks automatic removal.
 */
const DISPOSABLE_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "__pypackages__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".pytype",
  ".pyre",
  ".tox",
  ".nox",
  ".hypothesis",
  ".eggs",
  "htmlcov",
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  ".parcel-cache",
  ".svelte-kit",
  ".astro",
  ".angular",
  ".gradle",
  ".sass-cache",
  ".nyc_output",
  "bower_components",
  "playwright-report",
  "test-results",
]);

const DISPOSABLE_IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  ".eslintcache",
  ".stylelintcache",
  ".coverage",
  ".dmypy.json",
  "dmypy.json",
]);

const NO_EXTRA_IGNORED_NAMES: ReadonlySet<string> = new Set();

/** `git ls-files --others --ignored --exclude-standard --directory -z` output. */
export function ignoredPathsBlockWorktreeRemoval(
  stdout: string,
  truncated: boolean,
  extraNames: ReadonlySet<string> = NO_EXTRA_IGNORED_NAMES,
): boolean {
  if (truncated) return true;
  return stdout.split("\0").some((entry) => {
    if (entry === "") return false;
    const directory = entry.endsWith("/");
    const trimmed = directory ? entry.slice(0, -1) : entry;
    const slash = trimmed.lastIndexOf("/");
    const name = slash === -1 ? trimmed : trimmed.slice(slash + 1);
    if (extraNames.has(name)) return false;
    if (directory) {
      return !DISPOSABLE_IGNORED_DIRECTORIES.has(name) && !name.endsWith(".egg-info");
    }
    return (
      !DISPOSABLE_IGNORED_FILES.has(name) &&
      !name.endsWith(".pyc") &&
      !name.endsWith(".pyo") &&
      !name.endsWith(".tsbuildinfo")
    );
  });
}

function worktreeCleanupIgnoredNameSet(settings: ServerSettings): ReadonlySet<string> {
  return new Set(settings.storageCleanup.worktreeCleanupIgnoredNames);
}

/** Credential stores stay blockers even when a project gitignores them. */
const SECRET_IGNORED_DIRECTORY_NAMES = new Set([
  ".aws",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".secrets",
  ".ssh",
  "credentials",
  "secrets",
]);

const SUGGEST_CHECKOUT_LIMIT = 32;

function ignoredDirectoryBasename(entry: string): string | null {
  if (!entry.endsWith("/")) return null;
  const trimmed = entry.slice(0, -1);
  const slash = trimmed.lastIndexOf("/");
  const name = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  if (
    name.length === 0 ||
    DISPOSABLE_IGNORED_DIRECTORIES.has(name) ||
    name.endsWith(".egg-info") ||
    SECRET_IGNORED_DIRECTORY_NAMES.has(name) ||
    name.startsWith(".env") ||
    parseWorktreeCleanupIgnoredNames(name)?.length !== 1
  ) {
    return null;
  }
  return name;
}

function countedIgnoredDirectories(
  listings: ReadonlyArray<string>,
  limit: number,
  minimumCount: number,
): ReadonlyArray<{ readonly name: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const listing of listings) {
    const seen = new Set<string>();
    for (const entry of listing.split("\0")) {
      const name = ignoredDirectoryBasename(entry);
      if (name === null || seen.has(name) || name.length < 2) continue;
      seen.add(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minimumCount)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(0, limit))
    .map(([name, count]) => ({ name, count }));
}

/** Ignored directory names from `git ls-files --others --ignored --directory -z` listings. */
export function suggestedIgnoredDirectoryNames(
  listings: ReadonlyArray<string>,
  limit: number,
  minimumCount = 2,
): ReadonlyArray<string> {
  return countedIgnoredDirectories(listings, limit, minimumCount).map((entry) => entry.name);
}

/** Keeps model output that was actually present in the project scan. */
export function acceptedModelIgnoredNames(
  candidates: ReadonlyArray<string>,
  generated: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const allowed = new Set(candidates);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of generated) {
    const name = raw.trim();
    if (!allowed.has(name) || seen.has(name)) continue;
    if (parseWorktreeCleanupIgnoredNames(name)?.length !== 1) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= WORKTREE_CLEANUP_IGNORED_NAME_MAX_COUNT) break;
  }
  return names;
}

export const suggestWorktreeCleanupIgnoredNames = <E>(input: {
  readonly getShellSnapshot: (options?: {
    readonly location?: "active" | "archive";
  }) => Effect.Effect<OrchestrationV2ThreadShellSnapshot, E>;
  readonly projectStore: ProjectStore.ProjectStoreV2["Service"];
  readonly sql: SqlClient.SqlClient;
  readonly git: GitVcsDriver.GitVcsDriver["Service"];
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}) =>
  Effect.gen(function* () {
    const { getShellSnapshot, projectStore, sql, git, fs, path } = input;
    const active = yield* getShellSnapshot();
    const archived = yield* getShellSnapshot({ location: "archive" });
    const projects = yield* projectStore.listShells();
    const deletedRows = yield* sql<{ payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NOT NULL
    `;
    const deleted = yield* Effect.forEach(deletedRows, (row) =>
      decodeCleanupThread(row.payload_json).pipe(Effect.orElseSucceed(() => null)),
    );
    const roots: string[] = [];
    const seen = new Set<string>();
    const add = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed) return;
      const resolved = path.resolve(trimmed);
      if (seen.has(resolved) || roots.length >= SUGGEST_CHECKOUT_LIMIT) return;
      seen.add(resolved);
      roots.push(resolved);
    };
    for (const snapshot of [active, archived]) {
      for (const thread of [...snapshot.threads, ...snapshot.archivedThreads]) {
        add(thread.worktreePath);
      }
    }
    for (const thread of deleted) add(thread?.worktreePath);
    for (const project of projects) add(project.workspaceRoot);

    const listings = yield* Effect.forEach(
      roots,
      (cwd) =>
        Effect.gen(function* () {
          if (!(yield* fs.exists(cwd))) return "";
          const result = yield* git
            .execute({
              operation: "StorageCleanup.suggestIgnoredNames",
              cwd,
              args: [
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
                "-z",
              ],
              allowNonZeroExit: true,
              timeoutMs: 10_000,
              maxOutputBytes: 64 * 1024,
            })
            .pipe(Effect.orElseSucceed(() => null));
          return result !== null && result.exitCode === 0 ? result.stdout : "";
        }),
      { concurrency: 8 },
    );
    const directories = countedIgnoredDirectories(listings, 200, 1);
    if (directories.length === 0) return { names: [] };
    const settings = yield* (yield* Settings.ServerSettingsService).getSettings;
    const providers = yield* (yield* ProviderRegistry.ProviderRegistry).getProviders;
    const generated = yield* (yield* TextGeneration.TextGeneration).generateIgnoredNames({
      cwd: roots[0] ?? path.resolve("."),
      directories,
      modelSelection: resolveWorktreeCleanupModelSelection(settings, providers),
    });
    return {
      names: acceptedModelIgnoredNames(
        directories.map((entry) => entry.name),
        generated.names,
      ),
    };
  }).pipe(
    Effect.mapError((cause) =>
      isTextGenerationError(cause)
        ? cause
        : new TextGenerationError({
            operation: "generateIgnoredNames",
            detail: "Could not choose ignored directories.",
            cause,
          }),
    ),
  );

const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeOnDelete ||
  rules.worktreeUnchanged;

function anyWorktreePolicy(
  settings: ServerSettings,
  predicate: (rules: WorktreeCleanupRules) => boolean,
): boolean {
  return (
    predicate(resolveWorktreeCleanup(settings, null)) ||
    Object.keys(settings.projectSettingsOverrides).some((projectId) =>
      predicate(resolveWorktreeCleanup(settings, projectId as ProjectId)),
    )
  );
}

function sameProjectWorktreePolicies(left: ServerSettings, right: ServerSettings): boolean {
  return [
    ...new Set([
      ...Object.keys(left.projectSettingsOverrides),
      ...Object.keys(right.projectSettingsOverrides),
    ]),
  ].every((projectId) =>
    Equal.equals(
      left.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
      right.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
    ),
  );
}

/** Live sessions keep their cwd even when no turn is currently running. */
export function storageCleanupThreadIdle(thread: OrchestrationV2ThreadShell, now: number): boolean {
  return (
    thread.branch !== null &&
    thread.worktreePath !== null &&
    thread.activeRunId === null &&
    (thread.status === "idle" || thread.status === "failed") &&
    (thread.pendingBackgroundTasks?.length ?? 0) === 0 &&
    thread.pendingRuntimeRequest === null &&
    !threadHasQueuedTurnStart(thread, now)
  );
}

/** PR metadata refreshes must not reset the inactivity clock. */
export function storageCleanupActivityAt(thread: OrchestrationV2ThreadShell): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ].flatMap((value) => (value == null ? [] : [DateTime.toEpochMillis(value)])),
  );
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const conductorWorkspace = yield* ConductorWorkspace.ConductorWorkspace;
  const terminals = yield* TerminalManager.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, Map<string, TerminalSummary>>();
  const noteTerminal = (terminal: TerminalSummary) => {
    const threadTerminals =
      liveTerminals.get(terminal.threadId) ?? new Map<string, TerminalSummary>();
    threadTerminals.set(terminal.terminalId, terminal);
    liveTerminals.set(terminal.threadId, threadTerminals);
  };

  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const hasTerminal = (worktreePath: string) =>
    [...liveTerminals.values()]
      .flatMap((entries) => [...entries.values()])
      .some((terminal) => {
        if (terminal.status !== "starting" && terminal.status !== "running") return false;
        const cwd = path.resolve(terminal.cwd);
        return (
          (terminal.worktreePath !== null &&
            path.resolve(terminal.worktreePath) === worktreePath) ||
          cwd === worktreePath ||
          inside(worktreePath, cwd)
        );
      });

  const readThreads = Effect.fn("StorageCleanup.readThreads")(function* () {
    const active = yield* projections.getShellSnapshot();
    const archived = yield* projections.getShellSnapshot({ location: "archive" });
    const projects = yield* projectStore.listShells();
    return { projects, threads: [...active.threads, ...archived.threads] };
  });

  // Local threads under another project need not have a worktreePath of their own.
  const containsProjectRoot = Effect.fn("StorageCleanup.containsProjectRoot")(function* (
    worktreePath: string,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
  ) {
    for (const project of projects) {
      const projectPath = path.resolve(project.workspaceRoot);
      if (projectPath === worktreePath || inside(worktreePath, projectPath)) return true;
      const realPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => projectPath));
      if (realPath === worktreePath || inside(worktreePath, realPath)) return true;
    }
    return false;
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    serverSettings: ServerSettings,
    now: number,
  ) {
    if (!anyWorktreePolicy(serverSettings, worktreeCleanupEnabled)) return;
    if (!(yield* fs.exists(config.worktreesDir))) return;
    const hasDeleteRule = anyWorktreePolicy(serverSettings, (rules) => rules.worktreeOnDelete);
    const deletedRows = hasDeleteRule
      ? yield* sql<{ payload_json: string; workspaceRoot: string }>`
          SELECT t.payload_json, p.workspace_root AS "workspaceRoot"
          FROM orchestration_v2_projection_threads t
          JOIN projection_projects p ON p.project_id = t.project_id
          WHERE t.deleted_at IS NOT NULL
        `
      : [];
    const deletedThreads = (yield* Effect.forEach(deletedRows, (row) =>
      decodeCleanupThread(row.payload_json).pipe(
        Effect.map((thread) => ({ ...thread, workspaceRoot: row.workspaceRoot })),
      ),
    )).filter(
      (thread) =>
        thread.worktreePath !== null &&
        thread.branch !== null &&
        resolveWorktreeCleanup(serverSettings, thread.projectId).worktreeOnDelete,
    );
    const snapshot = yield* readThreads();
    const root = yield* fs.realPath(config.worktreesDir);
    const refreshedDefaultRefs = new Map<string, Set<string>>();
    const groups = Map.groupBy(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) => path.resolve(thread.worktreePath!),
    );
    const candidates = [
      ...[...groups.values()].flatMap((group) => (group.length === 1 ? [group[0]!] : [])),
      ...deletedThreads.filter((thread) => !groups.has(path.resolve(thread.worktreePath!))),
    ];
    for (const thread of candidates) {
      const settings = resolveWorktreeCleanup(serverSettings, thread.projectId);
      if (!worktreeCleanupEnabled(settings)) continue;
      const worktreePath = path.resolve(thread.worktreePath!);
      const deleted = "workspaceRoot" in thread;
      const project = deleted
        ? { workspaceRoot: thread.workspaceRoot }
        : snapshot.projects.find((entry) => entry.id === thread.projectId);
      if (
        project === undefined ||
        (!deleted && !storageCleanupThreadIdle(thread, now)) ||
        hasTerminal(worktreePath)
      )
        continue;
      yield* Effect.gen(function* () {
        if (!inside(root, worktreePath) || !(yield* fs.exists(worktreePath))) return;
        if ((yield* fs.realPath(worktreePath)) !== worktreePath) return;
        if (yield* containsProjectRoot(worktreePath, [project, ...snapshot.projects])) return;
        // A linked worktree has a .git file. Never remove a main checkout.
        if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File") return;
        const status = yield* git.statusDetailsLocal(worktreePath);
        if (!status.isRepo || status.branch !== thread.branch || status.hasWorkingTreeChanges)
          return;
        const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
        const ignored = yield* git.execute({
          operation: "StorageCleanup.ignoredFiles",
          cwd: worktreePath,
          args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
          maxOutputBytes: 64 * 1024,
        });
        // Ignored files can contain secrets or local datasets. Dependency installs
        // and regenerable tool caches do not; every other ignored path does.
        if (
          ignoredPathsBlockWorktreeRemoval(
            ignored.stdout,
            ignored.stdoutTruncated,
            worktreeCleanupIgnoredNameSet(serverSettings),
          )
        )
          return;
        const old =
          !deleted &&
          settings.worktreeAfterDays !== null &&
          storageCleanupActivityAt(thread) < now - settings.worktreeAfterDays * DAY_MS;
        let eligible = deleted || old;
        if (!eligible && (settings.worktreeUnchanged || settings.worktreeOnMerge)) {
          const repositoryCwd = path.resolve(project.workspaceRoot);
          const remote = yield* git.resolvePrimaryRemoteName(repositoryCwd);
          const branch = yield* git.resolveDefaultBranchName(repositoryCwd, remote);
          if (branch === null) return;
          const defaultRef = `refs/remotes/${remote}/${branch}`;
          const refreshed = refreshedDefaultRefs.get(repositoryCwd) ?? new Set<string>();
          if (!refreshed.has(defaultRef)) {
            yield* git.fetchRemoteTrackingBranch({
              cwd: repositoryCwd,
              remoteName: remote,
              remoteBranch: branch,
            });
            refreshed.add(defaultRef);
            refreshedDefaultRefs.set(repositoryCwd, refreshed);
          }
          const base = yield* git.resolveCommit({
            cwd: worktreePath,
            revision: defaultRef,
          });
          const ancestor = yield* git.execute({
            operation: "StorageCleanup.integratedBranch",
            cwd: worktreePath,
            args: ["merge-base", "--is-ancestor", head.commitSha, base.commitSha],
            allowNonZeroExit: true,
          });
          if (ancestor.exitCode !== 0) return;
          eligible = settings.worktreeUnchanged;
          if (!eligible && settings.worktreeOnMerge && thread.branch !== null) {
            const pullRequest = yield* gitManager.branchPullRequest(
              { cwd: worktreePath, branch: thread.branch },
              { refresh: true },
            );
            eligible = pullRequest?.state === "merged";
          }
        }
        if (!eligible) return;
        // Re-read after Git/host calls so a queued turn, resumed session or new
        // thread sharing this path cancels the removal.
        const latestSnapshot = yield* readThreads();
        if (yield* containsProjectRoot(worktreePath, [project, ...latestSnapshot.projects])) return;
        const latest = latestSnapshot.threads.filter(
          (entry) =>
            entry.worktreePath !== null && path.resolve(entry.worktreePath) === worktreePath,
        );
        if (hasTerminal(worktreePath)) return;
        if (deleted) {
          if (
            latest.length > 0 ||
            !resolveWorktreeCleanup(yield* settingsService.getSettings, thread.projectId)
              .worktreeOnDelete
          )
            return;
          // V2 deletion queues durable cleanup. Do not remove its checkout until
          // every effect has finished successfully or was explicitly cancelled.
          const pendingCleanup = yield* sql`
            SELECT 1 FROM orchestration_v2_effect_outbox
            WHERE thread_id = ${thread.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1
          `;
          if (pendingCleanup.length > 0) return;
        } else if (
          latest.length !== 1 ||
          latest[0]!.id !== thread.id ||
          !storageCleanupThreadIdle(latest[0]!, now) ||
          storageCleanupActivityAt(latest[0]!) !== storageCleanupActivityAt(thread)
        )
          return;
        // Sessions can outlive their run and can be shared across app threads.
        const sessionRows = yield* sql<{ payload_json: string }>`
          SELECT payload_json FROM orchestration_v2_projection_provider_sessions
          WHERE status != 'stopped'
        `;
        const sessions = yield* Effect.forEach(sessionRows, (row) =>
          decodeCleanupSession(row.payload_json),
        );
        if (
          sessions.some((session) => {
            const cwd = path.resolve(session.cwd);
            return cwd === worktreePath || inside(worktreePath, cwd);
          })
        )
          return;
        const finalStatus = yield* git.statusDetailsLocal(worktreePath);
        if (
          !finalStatus.isRepo ||
          finalStatus.branch !== thread.branch ||
          finalStatus.hasWorkingTreeChanges
        )
          return;
        if (
          (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
          head.commitSha
        )
          return;
        const finalIgnored = yield* git.execute({
          operation: "StorageCleanup.ignoredFiles",
          cwd: worktreePath,
          args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
          maxOutputBytes: 64 * 1024,
        });
        const latestSettings = yield* settingsService.getSettings;
        if (
          ignoredPathsBlockWorktreeRemoval(
            finalIgnored.stdout,
            finalIgnored.stdoutTruncated,
            worktreeCleanupIgnoredNameSet(latestSettings),
          )
        )
          return;
        const current = resolveWorktreeCleanup(latestSettings, thread.projectId);
        if (
          Object.keys(settings).some(
            (key) =>
              current[key as keyof typeof settings] !== settings[key as keyof typeof settings],
          )
        )
          return;
        // Same as a user removing the worktree: the repository's Conductor
        // archive script gets to clean up outside the checkout first.
        yield* conductorWorkspace.archiveWorktree({
          projectRoot: project.workspaceRoot,
          worktreePath,
        });
        yield* git.removeWorktree({ cwd: project.workspaceRoot, path: worktreePath, force: false });
        yield* gitManager.invalidateStatus(project.workspaceRoot);
        // Preserve branch and path: ProviderTurnStartService recreates the checkout
        // from that branch when the thread is resumed.
        yield* Effect.logInfo("storage cleanup removed worktree", { threadId: thread.id });
      }).pipe(
        (effect) => withWorkspaceLease(worktreePath, effect),
        Effect.catch((error) =>
          Effect.logDebug("storage cleanup skipped worktree", { threadId: thread.id, error }),
        ),
      );
    }
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number | null,
    now: number,
    rotatedLogs: boolean,
  ) {
    if (days === null || !(yield* fs.exists(root))) return;
    const realRoot = yield* fs.realPath(root);
    if (realRoot !== path.resolve(root)) return;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
          }
        }
      }
    });
    yield* visit(realRoot);
  });

  const sweep = Effect.fn("StorageCleanup.sweep")(function* () {
    const serverSettings = yield* settingsService.getSettings;
    const settings = serverSettings.storageCleanup;
    const now = yield* Clock.currentTimeMillis;
    yield* cleanWorktrees(serverSettings, now).pipe(
      Effect.catch((error) => Effect.logWarning("worktree cleanup failed", { error })),
    );
    yield* cleanFiles(
      config.browserArtifactsDir,
      settings.browserArtifactsAfterDays,
      now,
      false,
    ).pipe(
      Effect.catch((error) => Effect.logWarning("browser artifact cleanup failed", { error })),
    );
    yield* cleanFiles(config.logsDir, settings.logsAfterDays, now, true).pipe(
      Effect.catch((error) => Effect.logWarning("rotated log cleanup failed", { error })),
    );
  });
  const worker = yield* makeDrainableWorker(() =>
    sweep().pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => Effect.logWarning("storage cleanup failed", { cause }),
      ),
    ),
  );

  const start = Effect.fn("StorageCleanup.start")(function* () {
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals) noteTerminal(terminal);
        } else if (event.type === "upsert") {
          noteTerminal(event.terminal);
        } else {
          const threadTerminals = liveTerminals.get(event.threadId);
          threadTerminals?.delete(event.terminalId);
          if (threadTerminals?.size === 0) liveTerminals.delete(event.threadId);
        }
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changes = yield* settingsService.subscribeChanges;
    const events = engine.streamDomainEvents;
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* forkParked(
      worker
        .enqueue(undefined)
        .pipe(
          Effect.andThen(worker.drain),
          Effect.repeat(Schedule.spaced("1 hour")),
          Effect.asVoid,
        ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          sameProjectWorktreePolicies(settings, lastSettings)
        )
          return Effect.void;
        lastSettings = settings;
        return worker.enqueue(undefined);
      }),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        (event.type === "thread.deleted" || event.type === "provider-session.updated") &&
        anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnDelete)
          ? worker.enqueue(undefined)
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Storage cleanup event stream failed", { cause }),
        ),
      ),
    );
  });
  return { start, drain: worker.drain };
});
