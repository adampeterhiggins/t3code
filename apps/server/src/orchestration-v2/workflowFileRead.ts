// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { OrchestrationWorkflowFileError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

function workflowFilesRoot(home: string, configDir?: string): string {
  return NodePath.join(configDir?.trim() || NodePath.join(home, ".claude"), "projects");
}

export const readContainedWorkflowFile = Effect.fn("orchestration.readContainedWorkflowFile")(
  function* (input: {
    readonly path: string;
    readonly extension: string;
    readonly byteCap: number;
    readonly tail?: boolean;
    /** Read forward from this byte, at most `byteCap` bytes. A mid-file read that is not at EOF stops on a newline. */
    readonly start?: number;
    readonly configDir?: string;
  }) {
    if (!NodePath.isAbsolute(input.path) || NodePath.extname(input.path) !== input.extension) {
      return yield* new OrchestrationWorkflowFileError({
        reason: "invalid-path",
        path: input.path,
      });
    }

    const home = yield* HostProcess.HomeDirectory;
    const root = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(workflowFilesRoot(home, input.configDir)),
      catch: (cause) =>
        new OrchestrationWorkflowFileError({
          reason: "root-unavailable",
          path: input.path,
          cause,
        }),
    });

    // Realpath the FILE itself (not just its directory): a symlink named
    // like a transcript inside a contained directory must not escape.
    const resolved = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.path),
      catch: (cause) =>
        new OrchestrationWorkflowFileError({ reason: "not-found", path: input.path, cause }),
    });

    if (resolved !== root && !resolved.startsWith(`${root}${NodePath.sep}`)) {
      return yield* new OrchestrationWorkflowFileError({ reason: "outside-root", path: resolved });
    }
    if (NodePath.extname(resolved) !== input.extension) {
      return yield* new OrchestrationWorkflowFileError({
        reason: "wrong-extension",
        path: resolved,
      });
    }

    // fd inode vs path inode catches a swapped leaf, not a swapped intermediate
    // dir; root is 0700 ~/.claude, so that already needs the uid we run as.
    const read = yield* Effect.tryPromise({
      try: async () => {
        const handle = await NodeFSP.open(
          resolved,
          NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NONBLOCK ?? 0),
        );
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) {
            return { failure: "not-regular-file" as const };
          }
          const pathStat = await NodeFSP.lstat(resolved);
          if (stat.ino !== pathStat.ino || stat.dev !== pathStat.dev) {
            return { failure: "changed-during-read" as const };
          }
          const from =
            input.start !== undefined
              ? Math.min(Math.max(0, input.start), stat.size)
              : input.tail
                ? Math.max(0, stat.size - Math.min(stat.size, input.byteCap + 1))
                : 0;
          const length =
            input.start !== undefined
              ? Math.min(input.byteCap, stat.size - from)
              : Math.min(stat.size, input.byteCap + (input.tail ? 1 : 0));
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
          let consumed = bytesRead;
          let contentsBuffer = buffer.subarray(0, bytesRead);
          // A forward read stops on a newline so the next read starts on a character boundary.
          if (input.start !== undefined && from + bytesRead < stat.size) {
            const newline = contentsBuffer.lastIndexOf(0x0a);
            if (newline >= 0) {
              consumed = newline + 1;
              contentsBuffer = contentsBuffer.subarray(0, consumed);
            }
          }
          return {
            contents: contentsBuffer.toString("utf8"),
            truncated: from + consumed < stat.size,
            size: stat.size,
            bytesRead: consumed,
          };
        } finally {
          await handle.close();
        }
      },
      catch: (cause) =>
        new OrchestrationWorkflowFileError({ reason: "read-failed", path: resolved, cause }),
    });
    if ("failure" in read) {
      return yield* new OrchestrationWorkflowFileError({ reason: read.failure, path: resolved });
    }

    return {
      path: resolved,
      contents: read.contents,
      truncated: read.truncated,
      size: read.size,
      bytesRead: read.bytesRead,
    };
  },
);
