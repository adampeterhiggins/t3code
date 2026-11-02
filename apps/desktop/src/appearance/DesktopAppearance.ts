import { DesktopAppearanceSnapshot } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { resolveSymlinkTarget } from "@t3tools/shared/symlink";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { APPEARANCE_SNAPSHOT_CHANNEL } from "../ipc/channels.ts";
import type * as DesktopQuickMessage from "../quickMessage/DesktopQuickMessage.ts";
import { sendToQuickMessagePanel } from "../quickMessage/sendToQuickMessagePanel.ts";

export const DESKTOP_APPEARANCE_SNAPSHOT_FILE_NAME = "appearance-snapshot.json";

export function desktopAppearanceSnapshotPath(clientSettingsPath: string, path: Path.Path): string {
  return path.join(path.dirname(clientSettingsPath), DESKTOP_APPEARANCE_SNAPSHOT_FILE_NAME);
}

const AppearanceSnapshotJson = fromLenientJson(DesktopAppearanceSnapshot);
const decodeAppearanceSnapshotJson = Schema.decodeUnknownEffect(AppearanceSnapshotJson);
const encodeAppearanceSnapshotJson = Schema.encodeEffect(AppearanceSnapshotJson);
const decodeAppearanceSnapshot = Schema.decodeUnknownEffect(DesktopAppearanceSnapshot);

const DesktopAppearanceReadOperation = Schema.Literals(["read-file"]);

export class DesktopAppearanceReadError extends Schema.TaggedError<DesktopAppearanceReadError>()(
  "DesktopAppearanceReadError",
  {
    operation: DesktopAppearanceReadOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop appearance snapshot read failed during ${this.operation} at ${this.path}.`;
  }
}

const DesktopAppearanceWriteOperation = Schema.Literals([
  "decode-snapshot",
  "create-temporary-file-name",
  "resolve-symlink",
  "encode-document",
  "create-directory",
  "write-temporary-file",
  "replace-snapshot-file",
]);

export class DesktopAppearanceWriteError extends Schema.TaggedError<DesktopAppearanceWriteError>()(
  "DesktopAppearanceWriteError",
  {
    operation: DesktopAppearanceWriteOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop appearance snapshot write failed during ${this.operation} at ${this.path}.`;
  }
}

type LoadedSnapshot =
  | { readonly _tag: "ready"; readonly snapshot: DesktopAppearanceSnapshot | null }
  | { readonly _tag: "unreadable"; readonly error: DesktopAppearanceReadError };

const loadStoredSnapshot = Effect.fn("DesktopAppearance.load")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly snapshotPath: string;
}): Effect.fn.Return<LoadedSnapshot> {
  const read = yield* Effect.result(input.fileSystem.readFileString(input.snapshotPath));
  if (read._tag === "Failure") {
    if (read.failure.reason._tag === "NotFound") {
      return { _tag: "ready", snapshot: null };
    }
    yield* Effect.logWarning("Could not read the desktop appearance snapshot.", read.failure).pipe(
      Effect.annotateLogs({ snapshotPath: input.snapshotPath }),
    );
    return {
      _tag: "unreadable",
      error: new DesktopAppearanceReadError({
        operation: "read-file",
        path: input.snapshotPath,
        cause: read.failure,
      }),
    };
  }

  return yield* decodeAppearanceSnapshotJson(read.success).pipe(
    Effect.map((snapshot): LoadedSnapshot => ({ _tag: "ready", snapshot })),
    Effect.catchTags({
      SchemaError: (cause) =>
        Effect.logWarning("Could not decode the desktop appearance snapshot.", cause).pipe(
          Effect.annotateLogs({ snapshotPath: input.snapshotPath }),
          Effect.as({ _tag: "ready", snapshot: null } satisfies LoadedSnapshot),
        ),
    }),
  );
});

const writeAppearanceSnapshot = Effect.fn("DesktopAppearance.writeSnapshot")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly snapshotPath: string;
  readonly snapshot: DesktopAppearanceSnapshot;
  readonly suffix: string;
}): Effect.fn.Return<void, DesktopAppearanceWriteError> {
  const targetPath = yield* resolveSymlinkTarget(input.snapshotPath).pipe(
    Effect.provideService(FileSystem.FileSystem, input.fileSystem),
    Effect.provideService(Path.Path, input.path),
    Effect.mapError(
      (cause) =>
        new DesktopAppearanceWriteError({
          operation: "resolve-symlink",
          path: input.snapshotPath,
          cause,
        }),
    ),
  );
  const directory = input.path.dirname(targetPath);
  const tempPath = `${targetPath}.${process.pid}.${input.suffix}.tmp`;
  const encoded = yield* encodeAppearanceSnapshotJson(input.snapshot).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopAppearanceWriteError({
          operation: "encode-document",
          path: input.snapshotPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.makeDirectory(directory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopAppearanceWriteError({
          operation: "create-directory",
          path: directory,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopAppearanceWriteError({
          operation: "write-temporary-file",
          path: tempPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.rename(tempPath, targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopAppearanceWriteError({
          operation: "replace-snapshot-file",
          path: input.snapshotPath,
          cause,
        }),
    ),
  );
});

export class DesktopAppearance extends Context.Service<
  DesktopAppearance,
  {
    readonly get: Effect.Effect<DesktopAppearanceSnapshot | null, DesktopAppearanceReadError>;
    readonly publish: (
      snapshot: unknown,
    ) => Effect.Effect<
      DesktopAppearanceSnapshot,
      DesktopAppearanceWriteError,
      DesktopQuickMessage.DesktopQuickMessage
    >;
  }
>()("@t3tools/desktop/appearance/DesktopAppearance") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const snapshotPath = desktopAppearanceSnapshotPath(environment.clientSettingsPath, path);
  const loaded = yield* loadStoredSnapshot({ fileSystem, snapshotPath });
  const cache = yield* Ref.make(loaded);
  const gate = yield* Semaphore.make(1);

  const readCachedSnapshot = Effect.fn("DesktopAppearance.get")(function* () {
    const current = yield* Ref.get(cache);
    // An unreadable file stays an error so a caller cannot treat it as "no
    // snapshot" and write a default over it. Corrupt JSON is cached as null
    // and is not rewritten until a valid publish.
    if (current._tag === "unreadable") return yield* current.error;
    return current.snapshot;
  });

  return DesktopAppearance.of({
    get: readCachedSnapshot(),
    publish: Effect.fn("DesktopAppearance.publish")(function* (input: unknown) {
      return yield* gate.withPermits(1)(
        Effect.gen(function* () {
          const snapshot = yield* decodeAppearanceSnapshot(input).pipe(
            Effect.mapError(
              (cause) =>
                new DesktopAppearanceWriteError({
                  operation: "decode-snapshot",
                  path: snapshotPath,
                  cause,
                }),
            ),
          );
          const suffix = yield* crypto.randomUUIDv4().pipe(
            Effect.map((uuid) => uuid.replace(/-/g, "")),
            Effect.mapError(
              (cause) =>
                new DesktopAppearanceWriteError({
                  operation: "create-temporary-file-name",
                  path: snapshotPath,
                  cause,
                }),
            ),
          );
          yield* writeAppearanceSnapshot({
            fileSystem,
            path,
            snapshotPath,
            snapshot,
            suffix,
          });
          yield* Ref.set(cache, { _tag: "ready", snapshot });
          yield* sendToQuickMessagePanel(APPEARANCE_SNAPSHOT_CHANNEL, snapshot);
          return snapshot;
        }),
      );
    }),
  });
});

export const layer = Layer.effect(DesktopAppearance, make);
