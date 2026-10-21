import {
  WS_METHODS,
  type ManagedWorktree,
  type StorageCleanupReport,
  type WorktreeInventoryRemoveResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";

import {
  LiveRpcFailedError,
  LiveUsageError,
  jsonFlag,
  liveLocationFlags,
  printJson,
  reportLiveErrors,
  rpc,
  withLiveRpc,
} from "./liveRpc.ts";

const SIZE_CONCURRENCY = 4;

export const formatBytes = (bytes: number | null) => {
  if (bytes === null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${units[unit]}`;
};

export const describeWorktree = (worktree: ManagedWorktree, bytes?: number | null) => {
  const changes =
    worktree.dirty === null ? "unreadable" : worktree.dirty ? "local changes" : "clean";
  const pullRequest =
    worktree.pullRequest === null
      ? null
      : `PR #${worktree.pullRequest.number} ${worktree.pullRequest.state ?? "unsynced"}`;
  const running = worktree.threads.filter((thread) => thread.running).length;
  const threads =
    worktree.threads.length === 0
      ? "no threads"
      : `${worktree.threads.length} thread(s)${running > 0 ? `, ${running} running` : ""}`;
  const summary = [
    worktree.branch ?? "(detached)",
    worktree.state,
    changes,
    threads,
    pullRequest,
    bytes === undefined ? null : formatBytes(bytes),
  ].filter((part): part is string => part !== null);
  return [
    worktree.path,
    `  ${summary.join("  ")}`,
    ...worktree.threads.map((thread) => `  - ${thread.threadId}  ${thread.title}`),
  ];
};

const OUTCOME_TEXT: Record<WorktreeInventoryRemoveResult["results"][number]["outcome"], string> = {
  removed: "removed",
  dirty: "kept: it has local changes",
  running: "kept: a thread is still working in it",
  not_managed: "kept: not a managed worktree",
  failed: "failed",
};

export const formatCleanupReport = (report: StorageCleanupReport) => {
  const lines = [
    `${report.trigger} cleanup ${report.finishedAt}: ${report.counts.removed} removed, ${report.counts.kept} kept, ${report.counts.failed} failed, ${formatBytes(report.bytesFreed)} freed`,
  ];
  for (const entry of report.entries) {
    const target = entry.path ?? entry.kind;
    const thread = entry.threadTitle === null ? "" : `  (${entry.threadTitle})`;
    lines.push(`  ${entry.outcome.padEnd(7)}  ${target}  ${entry.reason}${thread}`);
  }
  if (report.omittedCount > 0) lines.push(`  …and ${report.omittedCount} more`);
  return lines;
};

const worktreeListCommand = Command.make("list", {
  ...liveLocationFlags,
  size: Flag.Boolean("size").pipe(
    Flag.withDescription("Measure each worktree's size on disk (slower)."),
    Flag.withDefault(false),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "List managed worktrees with their branch, threads, local changes, and pull request.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 worktree cli",
      Effect.fn("cli.worktree.list")(function* (client) {
        const { worktrees } = yield* rpc(client[WS_METHODS.worktreesList]({}));
        const sizes = flags.size
          ? yield* Effect.forEach(
              worktrees,
              (worktree) =>
                rpc(client[WS_METHODS.worktreesSize]({ path: worktree.path })).pipe(
                  Effect.map((result) => result.bytes),
                ),
              { concurrency: SIZE_CONCURRENCY },
            )
          : undefined;
        if (flags.json) {
          return yield* printJson(
            worktrees.map((worktree, index) =>
              sizes === undefined ? worktree : { ...worktree, bytes: sizes[index] ?? null },
            ),
          );
        }
        if (worktrees.length === 0) return yield* Console.log("No managed worktrees.");
        for (const [index, worktree] of worktrees.entries()) {
          for (const line of describeWorktree(worktree, sizes?.[index])) {
            yield* Console.log(line);
          }
        }
        if (sizes !== undefined) {
          const total = sizes.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0);
          yield* Console.log(`\n${worktrees.length} worktree(s), ${formatBytes(total)}`);
        }
      }),
    ),
  ),
);

const worktreeRemoveCommand = Command.make("remove", {
  ...liveLocationFlags,
  paths: Argument.String("path").pipe(
    Argument.withDescription("Worktree path. Repeat for several."),
    Argument.variadic({ min: 1 }),
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withDescription("Confirm the removal."),
    Flag.withDefault(false),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Remove managed worktrees. Branches and threads are kept; worktrees with local changes or running threads are refused.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const cwd = yield* HostProcess.WorkingDirectory;
      const paths = flags.paths.map((value) => path.resolve(cwd, value));
      if (!flags.yes) {
        return yield* reportLiveErrors(
          Effect.fail(new LiveUsageError({ detail: `Pass --yes to remove ${paths.join(", ")}.` })),
        );
      }
      yield* withLiveRpc(
        flags,
        "t3 worktree cli",
        Effect.fn("cli.worktree.remove")(function* (client) {
          const { results } = yield* rpc(client[WS_METHODS.worktreesRemove]({ paths }));
          if (flags.json) yield* printJson(results);
          else {
            for (const result of results) {
              yield* Console.log(`${result.path}  ${OUTCOME_TEXT[result.outcome]}`);
            }
          }
          const notRemoved = results.filter((result) => result.outcome !== "removed").length;
          if (notRemoved > 0) {
            return yield* new LiveRpcFailedError({
              detail: `${notRemoved} worktree(s) were not removed.`,
            });
          }
        }),
      );
    }),
  ),
);

const worktreeCleanupCommand = Command.make("cleanup", {
  ...liveLocationFlags,
  run: Flag.Boolean("run").pipe(
    Flag.withDescription(
      "Run cleanup now with the rules in Settings > Storage. Without it, show the last report.",
    ),
    Flag.withDefault(false),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show the last storage cleanup report, or run cleanup now with --run."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 worktree cli",
      Effect.fn("cli.worktree.cleanup")(function* (client) {
        const report = flags.run
          ? yield* rpc(client[WS_METHODS.serverRunStorageCleanup]({}))
          : Option.getOrNull(
              yield* rpc(client[WS_METHODS.serverGetStorageCleanupReport]({}).pipe(Stream.runHead)),
            );
        if (flags.json) return yield* printJson(report);
        if (report === null) {
          return yield* Console.log("No cleanup has run yet. Pass --run to run one now.");
        }
        for (const line of formatCleanupReport(report)) yield* Console.log(line);
      }),
    ),
  ),
);

export const worktreeCommand = Command.make("worktree").pipe(
  Command.withDescription("List, measure, and safely remove the worktrees T3 Code manages."),
  Command.withSubcommands([worktreeListCommand, worktreeRemoveCommand, worktreeCleanupCommand]),
);
