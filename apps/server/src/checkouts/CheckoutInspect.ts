import {
  CheckoutInspectEntry,
  type CheckoutInspectInput,
  type CheckoutInspectResult,
} from "@t3tools/contracts";
import { checkoutDisplayName, checkoutPathKey } from "@t3tools/shared/checkouts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/**
 * Reads git state for paths the client already named. It does not search the disk
 * for repositories.
 */
export class CheckoutInspect extends Context.Service<
  CheckoutInspect,
  {
    readonly inspect: (input: CheckoutInspectInput) => Effect.Effect<CheckoutInspectResult>;
  }
>()("t3/checkouts/CheckoutInspect") {}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;

  const readEntry = (rawPath: string) =>
    Effect.gen(function* () {
      const path = checkoutPathKey(rawPath);
      const realPath = yield* fileSystem.realPath(path).pipe(Effect.orElseSucceed(() => null));
      if (realPath === null) {
        return emptyEntry(path);
      }
      const status = yield* git
        .statusDetailsLocal(realPath, { includeDivergence: false })
        .pipe(Effect.orElseSucceed(() => null));
      const head = yield* git
        .execute({
          operation: "CheckoutInspect.head",
          cwd: realPath,
          args: ["log", "-1", "--format=%H%x00%s"],
          allowNonZeroExit: true,
          timeoutMs: 10_000,
          maxOutputBytes: 8_192,
        })
        .pipe(Effect.orElseSucceed(() => null));
      const commonDir = yield* git
        .execute({
          operation: "CheckoutInspect.commonDir",
          cwd: realPath,
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          allowNonZeroExit: true,
          timeoutMs: 10_000,
          maxOutputBytes: 4_096,
        })
        .pipe(Effect.orElseSucceed(() => null));
      const [headSha, headSubject] = splitHead(head);
      const repositoryKey =
        commonDir !== null && commonDir.exitCode === 0 && commonDir.stdout.trim().length > 0
          ? commonDir.stdout.trim()
          : null;
      const isRepo = status?.isRepo === true || repositoryKey !== null;
      return entry({
        path: realPath,
        exists: true,
        isRepo,
        name: checkoutDisplayName(realPath),
        branch: status?.branch ?? null,
        headSha,
        headSubject,
        changedFiles: status?.workingTree.files.length ?? 0,
        ahead: status?.aheadCount ?? 0,
        repositoryKey: isRepo ? repositoryKey : null,
      });
    });

  return CheckoutInspect.of({
    inspect: (input) =>
      Effect.gen(function* () {
        const entries = yield* Effect.forEach(input.paths, readEntry, { concurrency: 4 });
        return { entries };
      }),
  });
});

function emptyEntry(path: string): CheckoutInspectEntry {
  return entry({
    path,
    exists: false,
    isRepo: false,
    name: checkoutDisplayName(path),
    branch: null,
    headSha: null,
    headSubject: null,
    changedFiles: 0,
    ahead: 0,
    repositoryKey: null,
  });
}

function entry(value: CheckoutInspectEntry): CheckoutInspectEntry {
  return value;
}

function splitHead(
  result: { readonly exitCode: number; readonly stdout: string } | null,
): [string | null, string | null] {
  if (result === null || result.exitCode !== 0) return [null, null];
  const [sha, subject] = result.stdout.trim().split("\0");
  return [sha && sha.length > 0 ? sha : null, subject && subject.length > 0 ? subject : null];
}

export const layer = Layer.effect(CheckoutInspect, make);
