import {
  CONTEXT_REPOSITORY_DETAIL_MAX_CHARS,
  ContextRepositoryDirectoryName,
  ContextRepositoryError,
  DEFAULT_CONTEXT_REPOSITORY_DIRECTORY,
  contextRepositoryRemoteKey,
  type ContextRepositoryCandidate,
  type ContextRepositoryClone,
  type ContextRepositoryGitStatus,
  type ContextRepositoryInspectResult,
  type ContextRepositoryListInput,
  type ContextRepositoryListResult,
  type ContextRepositoryOutcome,
  type RepositoryContextRecord,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import type { GitCloneProgressLine } from "../project/gitCloneProgress.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";

/**
 * Clones repositories attached to a message into the workspace's context
 * directory, the way `ctxclone` does by hand: full clones side by side under
 * `.context/<folder>`. An existing clone of the same remote is left alone
 * (fetched only, so its ahead/behind is current); anything else in the way
 * is reported, never overwritten. Every outcome carries the clone's git
 * status so the chip and the agent can both see what they are working with.
 */
export class ContextRepositories extends Context.Service<
  ContextRepositories,
  {
    /**
     * Each owner's repositories in the owners' order, most recently pushed first
     * within an owner. Fails only when every owner does. GitHub only.
     */
    readonly list: (
      input: ContextRepositoryListInput,
    ) => Effect.Effect<ContextRepositoryListResult, ContextRepositoryError>;
    /** Clones already in the workspace's context directory, without touching the network. */
    readonly inspect: (input: {
      readonly cwd: string;
      readonly directory: string;
    }) => Effect.Effect<ContextRepositoryInspectResult, ContextRepositoryError>;
    /**
     * Deletes one clone from the workspace's context directory. Refuses a
     * folder that resolves outside that directory (a symlink, or a context
     * directory that is itself a link out of the workspace), one that is not a
     * git repository, and any removal while a turn is running in the workspace.
     * Waits for a clone of the same folder to finish, and holds the workspace
     * lease while deleting so a turn starting in the workspace waits for it.
     */
    readonly remove: (input: {
      readonly cwd: string;
      readonly directory: string;
      readonly directoryName: string;
    }) => Effect.Effect<void, ContextRepositoryError>;
    /**
     * Makes sure every record's clone exists and returns each record with its
     * outcome filled in. Never fails: a problem is that record's outcome.
     */
    readonly ensure: (input: {
      readonly cwd: string;
      readonly directory: string;
      readonly repositories: ReadonlyArray<RepositoryContextRecord>;
      readonly onProgress?: (event: ContextRepositoryProgress) => Effect.Effect<void>;
    }) => Effect.Effect<ReadonlyArray<RepositoryContextRecord>>;
  }
>()("t3/contextRepositories/ContextRepositories") {}

export type ContextRepositoryProgress =
  | { readonly type: "started"; readonly record: RepositoryContextRecord }
  | {
      readonly type: "clone-progress";
      readonly record: RepositoryContextRecord;
      readonly line: GitCloneProgressLine;
    }
  | {
      readonly type: "finished";
      readonly record: RepositoryContextRecord;
      readonly outcome: ContextRepositoryOutcome;
    };

const DEFAULT_LIST_LIMIT = 200;
const LIST_CONCURRENCY = 4;
// `gh repo list` takes a second or more per owner and the picker lists every
// configured owner on each open, so lists are kept in memory per owner the way
// ctxclone keeps them on disk, and refreshed in the background once this old.
const LIST_REFRESH_AFTER_MS = 5 * 60_000;
// A full clone of a large repository takes minutes; a stuck one must still
// end so the turn it holds up can start.
const CLONE_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 60_000;
const ENSURE_CONCURRENCY = 4;
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } satisfies NodeJS.ProcessEnv;

const isDirectoryName = Schema.is(ContextRepositoryDirectoryName);

const RawRepositoryList = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      nameWithOwner: Schema.String,
      url: Schema.String,
      description: Schema.optional(Schema.NullOr(Schema.String)),
      pushedAt: Schema.optional(Schema.NullOr(Schema.String)),
      isPrivate: Schema.optional(Schema.Boolean),
    }),
  ),
);
const decodeRawRepositoryList = Schema.decodeUnknownEffect(RawRepositoryList);

/**
 * Parses `git status --porcelain=v2 --branch`. Header lines carry the branch
 * and upstream counts; every other non-empty line is one changed path.
 */
export function parsePorcelainV2Status(stdout: string): ContextRepositoryGitStatus {
  let branch: string | null = null;
  let headSha: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let changedFiles = 0;
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    if (!line.startsWith("# ")) {
      changedFiles += 1;
      continue;
    }
    const [key, ...rest] = line.slice(2).split(" ");
    const value = rest.join(" ");
    switch (key) {
      case "branch.oid":
        headSha = value === "(initial)" ? null : value;
        break;
      case "branch.head":
        branch = value === "(detached)" ? null : value;
        break;
      case "branch.upstream":
        upstream = value;
        break;
      case "branch.ab": {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
        break;
      }
    }
  }
  return { branch, headSha, upstream, ahead, behind, changedFiles };
}

/** Drops `user:token@` so a remote read from `.git/config` is safe to show and store. */
function redactRemote(remoteUrl: string): string {
  return remoteUrl.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, "$1");
}

function clampDetail(detail: string): string {
  return detail.length > CONTEXT_REPOSITORY_DETAIL_MAX_CHARS
    ? `${detail.slice(0, CONTEXT_REPOSITORY_DETAIL_MAX_CHARS - 1)}…`
    : detail;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const github = yield* GitHubCli.GitHubCli;
  const repositories = yield* SourceControlRepositoryService.SourceControlRepositoryService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const ownerLists = new Map<
    string,
    { readonly fetchedAt: number; readonly repositories: ReadonlyArray<ContextRepositoryCandidate> }
  >();
  const refreshingOwners = new Set<string>();
  const ownerListKey = (owner: string, limit: number) => `${owner.toLowerCase()}\n${limit}`;

  /**
   * The context directory, relative to the workspace for display and absolute
   * for work. A setting that points outside the workspace is refused rather
   * than cloned into.
   */
  const resolveDirectory = (cwd: string, setting: string) => {
    const relative = path.normalize(setting.trim() || DEFAULT_CONTEXT_REPOSITORY_DIRECTORY);
    const absolute = path.resolve(cwd, relative);
    const inside = path.relative(cwd, absolute);
    if (
      path.isAbsolute(setting.trim()) ||
      inside.length === 0 ||
      inside === ".." ||
      inside.startsWith(`..${path.sep}`)
    ) {
      return Effect.fail(
        new ContextRepositoryError({
          detail: `The context repository folder "${setting}" must be inside the workspace.`,
        }),
      );
    }
    return Effect.succeed({ relative: inside.split(path.sep).join("/"), absolute });
  };

  const runGit = (
    cwd: string,
    operation: string,
    args: ReadonlyArray<string>,
    timeoutMs = 15_000,
  ) =>
    git.execute({
      operation: `ContextRepositories.${operation}`,
      cwd,
      args,
      env: GIT_ENV,
      allowNonZeroExit: true,
      timeoutMs,
    });

  const readOrigin = (clonePath: string) =>
    runGit(clonePath, "readOrigin", ["config", "--get", "remote.origin.url"]).pipe(
      Effect.map((result) => {
        const remote = result.stdout.trim();
        return result.exitCode === 0 && remote.length > 0 ? remote : null;
      }),
      Effect.orElseSucceed(() => null),
    );

  const readStatus = (clonePath: string) =>
    runGit(clonePath, "status", ["status", "--porcelain=v2", "--branch"]).pipe(
      Effect.map((result) =>
        result.exitCode === 0 ? parsePorcelainV2Status(result.stdout) : null,
      ),
      Effect.orElseSucceed(() => null),
    );

  const isGitRepository = (directory: string) =>
    fileSystem.exists(path.join(directory, ".git")).pipe(Effect.orElseSucceed(() => false));

  /**
   * Keeps clones out of the workspace's own git: checkpoints and diffs would
   * otherwise see nested repositories. Uses `info/exclude` so no tracked file
   * changes; a repository that already ignores the folder is left alone.
   */
  const ensureExcluded = (cwd: string, relativeDirectory: string) =>
    Effect.gen(function* () {
      const ignored = yield* runGit(cwd, "checkIgnore", [
        "check-ignore",
        "-q",
        `${relativeDirectory}/`,
      ]);
      // 0: ignored. 1: not ignored. Anything else: not a repository, or git failed.
      if (ignored.exitCode !== 1) return;
      const prefix = (yield* runGit(cwd, "showPrefix", [
        "rev-parse",
        "--show-prefix",
      ])).stdout.trim();
      const excludePath = (yield* runGit(cwd, "excludePath", [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "info/exclude",
      ])).stdout.trim();
      if (excludePath.length === 0) return;
      const existing = yield* fileSystem
        .readFileString(excludePath)
        .pipe(Effect.orElseSucceed(() => ""));
      const pattern = `/${prefix}${relativeDirectory}/`;
      if (existing.split("\n").includes(pattern)) return;
      yield* fileSystem.makeDirectory(path.dirname(excludePath), { recursive: true });
      yield* fileSystem.writeFileString(
        excludePath,
        `${existing}${existing.length === 0 || existing.endsWith("\n") ? "" : "\n"}# T3 Code context repositories\n${pattern}\n`,
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("could not exclude the context repository folder", { cwd, cause }),
      ),
    );

  const ensureOne = (
    directory: { readonly relative: string; readonly absolute: string },
    record: RepositoryContextRecord,
    onProgress: (event: ContextRepositoryProgress) => Effect.Effect<void>,
  ) =>
    Effect.gen(function* () {
      const clonePath = path.join(directory.absolute, record.directoryName);
      const relativePath = `${directory.relative}/${record.directoryName}`;
      const outcomeOf = (
        status: ContextRepositoryOutcome["status"],
        fields: Partial<Omit<ContextRepositoryOutcome, "status" | "path">> = {},
      ): ContextRepositoryOutcome => ({
        status,
        path: relativePath,
        detail: fields.detail ? clampDetail(fields.detail) : null,
        git: fields.git ?? null,
        fetched: fields.fetched ?? false,
      });
      yield* onProgress({ type: "started", record });

      const exists = yield* fileSystem.exists(clonePath).pipe(Effect.orElseSucceed(() => false));
      const entries = exists
        ? yield* fileSystem.readDirectory(clonePath).pipe(Effect.orElseSucceed(() => null))
        : [];
      if (entries === null) {
        return outcomeOf("conflict", { detail: `${relativePath} exists and is not a folder.` });
      }

      if (entries.length > 0) {
        if (!(yield* isGitRepository(clonePath))) {
          return outcomeOf("conflict", {
            detail: `${relativePath} already exists and is not a git repository.`,
          });
        }
        const origin = yield* readOrigin(clonePath);
        if (
          origin === null ||
          contextRepositoryRemoteKey(origin) !== contextRepositoryRemoteKey(record.remoteUrl)
        ) {
          return outcomeOf("conflict", {
            detail:
              origin === null
                ? `${relativePath} is a git repository with no origin remote.`
                : `${relativePath} is a clone of ${redactRemote(origin)}.`,
            git: yield* readStatus(clonePath),
          });
        }
        // Left as it is, like ctxclone. A fetch only moves remote-tracking
        // refs, so ahead/behind describe the remote as it is now.
        const fetch = yield* runGit(
          clonePath,
          "fetch",
          ["fetch", "--quiet", "origin"],
          FETCH_TIMEOUT_MS,
        ).pipe(
          Effect.map((result) => result.exitCode === 0),
          Effect.orElseSucceed(() => false),
        );
        return outcomeOf("present", {
          git: yield* readStatus(clonePath),
          fetched: fetch,
          ...(fetch
            ? {}
            : { detail: "Could not fetch origin; ahead/behind is as of the last fetch." }),
        });
      }

      // The folder was missing or empty, so anything in it now is this clone's.
      // A timed-out or cancelled git leaves a partial `.git` that would read as
      // an existing clone next time; remove it.
      const discardPartial = fileSystem
        .remove(clonePath, { recursive: true, force: true })
        .pipe(Effect.ignore);
      return yield* repositories
        .cloneRepository(
          { remoteUrl: record.remoteUrl, destinationPath: clonePath },
          {
            timeoutMs: CLONE_TIMEOUT_MS,
            onProgress: (line) => onProgress({ type: "clone-progress", record, line }),
          },
        )
        .pipe(
          Effect.onInterrupt(() => discardPartial),
          Effect.flatMap(() => readStatus(clonePath)),
          Effect.map((status) => outcomeOf("cloned", { git: status })),
          Effect.catch((error) =>
            discardPartial.pipe(Effect.as(outcomeOf("failed", { detail: error.detail }))),
          ),
        );
    }).pipe(
      // Keyed by the clone's own path, so a removal of the same folder waits
      // for the clone instead of deleting it half-written.
      (effect) => withWorkspaceLease(path.join(directory.absolute, record.directoryName), effect),
      Effect.tap((outcome) => onProgress({ type: "finished", record, outcome })),
      Effect.map((outcome): RepositoryContextRecord => ({ ...record, outcome })),
    );

  const ensure: ContextRepositories["Service"]["ensure"] = (input) =>
    Effect.gen(function* () {
      if (input.repositories.length === 0) return input.repositories;
      const onProgress = input.onProgress ?? (() => Effect.void);
      const directory = yield* resolveDirectory(input.cwd, input.directory).pipe(Effect.result);
      if (directory._tag === "Failure") {
        const detail = directory.failure.detail;
        return input.repositories.map((record): RepositoryContextRecord => ({
          ...record,
          outcome: {
            status: "failed",
            path: record.directoryName,
            detail,
            git: null,
            fetched: false,
          },
        }));
      }
      yield* ensureExcluded(input.cwd, directory.success.relative);
      yield* fileSystem
        .makeDirectory(directory.success.absolute, { recursive: true })
        .pipe(Effect.ignore);
      return yield* Effect.forEach(
        input.repositories,
        (record) =>
          isDirectoryName(record.directoryName)
            ? ensureOne(directory.success, record, onProgress)
            : Effect.succeed<RepositoryContextRecord>({
                ...record,
                outcome: {
                  status: "failed",
                  path: record.directoryName,
                  detail: "The folder name must be a single path segment.",
                  git: null,
                  fetched: false,
                },
              }),
        { concurrency: ENSURE_CONCURRENCY },
      );
    });

  const inspect: ContextRepositories["Service"]["inspect"] = (input) =>
    Effect.gen(function* () {
      const directory = yield* resolveDirectory(input.cwd, input.directory);
      const entries = yield* fileSystem
        .readDirectory(directory.absolute)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      const clones = yield* Effect.forEach(
        entries.filter(isDirectoryName).toSorted(),
        (directoryName) =>
          Effect.gen(function* () {
            const clonePath = path.join(directory.absolute, directoryName);
            if (!(yield* isGitRepository(clonePath))) return null;
            const origin = yield* readOrigin(clonePath);
            const clone: ContextRepositoryClone = {
              directoryName,
              remoteUrl: origin === null ? null : redactRemote(origin),
              git: yield* readStatus(clonePath),
            };
            return clone;
          }),
        { concurrency: 8 },
      );
      return {
        directory: directory.relative,
        clones: clones.filter((clone) => clone !== null),
      };
    });

  const isInside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative.length > 0 &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };

  /**
   * Whether a thread has unfinished work in this exact workspace (a worktree,
   * or its project's root): a run preparing, starting, running, or waiting on
   * the user.
   */
  const hasRunningTurn = (workspace: string) =>
    Effect.gen(function* () {
      const snapshot = yield* projections.getShellSnapshot({ unsettledOnly: true });
      const running = snapshot.threads.filter(
        (thread) => (thread.activityRunStatus ?? null) !== null,
      );
      if (running.length === 0) return false;
      const roots = new Map(
        (yield* projects.listShells({
          projectIds: [...new Set(running.map((thread) => thread.projectId))],
        })).map((project) => [project.id, project.workspaceRoot] as const),
      );
      return running.some((thread) => {
        const cwd = thread.worktreePath ?? roots.get(thread.projectId);
        return cwd !== undefined && path.resolve(cwd) === workspace;
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ContextRepositoryError({
            detail: "Could not check for running turns in this workspace.",
            cause,
          }),
      ),
    );

  const removeLocked = (input: {
    readonly workspace: string;
    readonly directory: { readonly relative: string; readonly absolute: string };
    readonly clonePath: string;
    readonly directoryName: string;
  }) =>
    Effect.gen(function* () {
      const { workspace, directory, clonePath } = input;
      const relativePath = `${directory.relative}/${input.directoryName}`;
      const realPathOf = (target: string) =>
        fileSystem
          .realPath(target)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ContextRepositoryError({ detail: `${relativePath} does not exist.`, cause }),
            ),
          );
      // Compare resolved paths so a symlinked clone, or a context folder that
      // links out of the workspace, is refused rather than followed.
      const realWorkspace = yield* realPathOf(workspace);
      const realDirectory = yield* realPathOf(directory.absolute);
      const realClone = yield* realPathOf(clonePath);
      if (
        !isInside(realWorkspace, realDirectory) ||
        realClone !== path.join(realDirectory, input.directoryName)
      ) {
        return yield* new ContextRepositoryError({
          detail: `${relativePath} resolves outside ${directory.relative}; it was not removed.`,
        });
      }
      if (!(yield* isGitRepository(realClone))) {
        return yield* new ContextRepositoryError({
          detail: `${relativePath} is not a git repository; it was not removed.`,
        });
      }
      if (yield* hasRunningTurn(workspace)) {
        return yield* new ContextRepositoryError({
          detail: "A turn is running in this workspace. Remove the repository once it finishes.",
        });
      }
      yield* fileSystem
        .remove(realClone, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ContextRepositoryError({ detail: `Could not remove ${relativePath}.`, cause }),
          ),
        );
    });

  const remove: ContextRepositories["Service"]["remove"] = (input) =>
    Effect.gen(function* () {
      if (!isDirectoryName(input.directoryName)) {
        return yield* new ContextRepositoryError({
          detail: "The folder name must be a single path segment.",
        });
      }
      const workspace = path.resolve(input.cwd);
      const directory = yield* resolveDirectory(workspace, input.directory);
      const clonePath = path.join(directory.absolute, input.directoryName);
      // The clone's lease first, so waiting on a clone never holds up turns
      // and terminals in the workspace; turn start takes only the workspace's.
      return yield* withWorkspaceLease(
        clonePath,
        withWorkspaceLease(
          workspace,
          removeLocked({ workspace, directory, clonePath, directoryName: input.directoryName }),
        ),
      );
    });

  const fetchOwner = (owner: string, limit: number) =>
    github
      .execute({
        cwd: config.cwd,
        args: [
          "repo",
          "list",
          owner,
          "--no-archived",
          "--limit",
          String(limit),
          "--json",
          "name,nameWithOwner,url,description,pushedAt,isPrivate",
        ],
      })
      .pipe(
        Effect.mapError(
          (error) => new ContextRepositoryError({ detail: error.message, cause: error }),
        ),
        Effect.flatMap((result) =>
          decodeRawRepositoryList(result.stdout.trim() || "[]").pipe(
            Effect.mapError(
              (cause) =>
                new ContextRepositoryError({
                  detail: "GitHub returned a repository list T3 Code could not read.",
                  cause,
                }),
            ),
          ),
        ),
        Effect.map((raw) =>
          raw
            .map((entry): ContextRepositoryCandidate => ({
              name: entry.name,
              nameWithOwner: entry.nameWithOwner,
              url: entry.url,
              description: entry.description?.trim() || null,
              pushedAt: entry.pushedAt ?? null,
              isPrivate: entry.isPrivate ?? false,
            }))
            .toSorted((left, right) => (right.pushedAt ?? "").localeCompare(left.pushedAt ?? "")),
        ),
        Effect.tap((repositories) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((fetchedAt) =>
              ownerLists.set(ownerListKey(owner, limit), { fetchedAt, repositories }),
            ),
          ),
        ),
      );

  /**
   * One owner's list, served from memory when there is one. A list older than
   * `LIST_REFRESH_AFTER_MS` is still served, and refetched in the background for
   * the next open; a failed refetch keeps the old list.
   */
  const listOwner = (owner: string, limit: number) =>
    Effect.gen(function* () {
      const key = ownerListKey(owner, limit);
      const cached = ownerLists.get(key);
      if (cached === undefined) return yield* fetchOwner(owner, limit);
      const now = yield* Clock.currentTimeMillis;
      if (now - cached.fetchedAt > LIST_REFRESH_AFTER_MS && !refreshingOwners.has(key)) {
        refreshingOwners.add(key);
        yield* fetchOwner(owner, limit).pipe(
          Effect.ignoreCause({ log: true }),
          Effect.ensuring(Effect.sync(() => refreshingOwners.delete(key))),
          Effect.forkDetach,
        );
      }
      return cached.repositories;
    });

  const list: ContextRepositories["Service"]["list"] = (input) =>
    Effect.gen(function* () {
      const limit = input.limit ?? DEFAULT_LIST_LIMIT;
      const owners = [...new Set(input.owners ?? [input.owner])];
      const results = yield* Effect.forEach(
        owners,
        (owner) => Effect.result(listOwner(owner, limit)),
        { concurrency: LIST_CONCURRENCY },
      );
      const lists = results.filter(Result.isSuccess).map((result) => result.success);
      // One misspelled owner should not hide every other owner's repositories.
      const failure = results.find(Result.isFailure);
      if (lists.length === 0 && failure !== undefined) return yield* failure.failure;
      return { repositories: lists.flat() };
    });

  return ContextRepositories.of({ list, inspect, remove, ensure });
});

export const layer = Layer.effect(ContextRepositories, make);
