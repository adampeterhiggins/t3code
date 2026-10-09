import { describe, expect, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadShellSnapshot,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Settings from "../serverSettings.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as Workflow from "./GitWorkflowService.ts";
import * as Inventory from "./WorktreeInventory.ts";

// Only shell fields the inventory reads are needed at this service boundary.
const thread = (worktreePath: string, running = false) =>
  ({
    id: "thread",
    title: "Linked thread",
    projectId: "project",
    worktreePath,
    status: "idle",
    activeRunId: running ? "run" : null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    queuedMessages: [],
    latestRunId: null,
    archivedAt: null,
    settledAt: null,
    branch: "feature",
    pullRequests: [],
  }) as unknown as OrchestrationV2ThreadShell;
const snapshot = (threads: readonly OrchestrationV2ThreadShell[]) =>
  ({
    schemaVersion: 1,
    snapshotSequence: 0,
    threads,
    archivedThreads: [],
  }) satisfies OrchestrationV2ThreadShellSnapshot;
const status = (dirty: boolean) =>
  ({ isRepo: true, branch: "feature", hasWorkingTreeChanges: dirty }) as Git.GitStatusDetails;

const harness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const checkout = path.join(root, "repo", "feature");
  yield* fs.makeDirectory(checkout, { recursive: true });
  yield* fs.writeFileString(path.join(checkout, ".git"), "gitdir: /repo/.git/worktrees/feature");
  const remove = vi.fn(() => Effect.void);
  let dirty = false;
  let threads: readonly OrchestrationV2ThreadShell[] = [];
  let projectRoot: string | null = null;
  const layer = Inventory.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerConfig.ServerConfig)({
          worktreesDir: root,
        } as ServerConfig.ServerConfig["Service"]),
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        }),
        Layer.mock(Threads.ThreadManagementService)({
          getShellSnapshot: () => Effect.sync(() => snapshot(threads)),
        }),
        Layer.mock(Projects.ProjectService)({
          listShells: () =>
            Effect.sync(() =>
              projectRoot === null
                ? []
                : ([{ workspaceRoot: projectRoot }] as unknown as AwaitedProjectShells),
            ),
        }),
        Layer.mock(Git.GitVcsDriver)({
          statusDetailsLocal: () => Effect.sync(() => status(dirty)),
          execute: () =>
            Effect.succeed({
              stdout: "/repo/.git",
              stderr: "",
              exitCode: 0,
              stdoutTruncated: false,
              stderrTruncated: false,
            } as Git.ExecuteGitResult),
        }),
        Layer.mock(Workflow.GitWorkflowService)({ removeWorktree: remove }),
        Layer.mock(ProcessRunner.ProcessRunner)({
          run: () => Effect.die("unexpected size subprocess"),
        }),
      ),
    ),
  );
  return {
    layer,
    checkout,
    root,
    remove,
    setDirty: (value: boolean) => {
      dirty = value;
    },
    setThreads: (value: readonly OrchestrationV2ThreadShell[]) => {
      threads = value;
    },
    setProject: (value: string) => {
      projectRoot = value;
    },
  };
});
type AwaitedProjectShells = Effect.Success<
  ReturnType<Projects.ProjectService["Service"]["listShells"]>
>;

describe("WorktreeInventory", () => {
  it.effect("lists managed checkouts with linked thread and dirty state", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.setThreads([thread(h.checkout)]);
      h.setDirty(true);
      const result = yield* Inventory.WorktreeInventory.use((inventory) => inventory.list).pipe(
        Effect.provide(h.layer),
      );
      expect(result.worktrees).toHaveLength(1);
      expect(result.worktrees[0]).toMatchObject({
        path: h.checkout,
        dirty: true,
        state: "active",
        threads: [{ title: "Linked thread", running: false }],
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rechecks running work and local changes and never removes either", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const remove = () =>
        Inventory.WorktreeInventory.use((inventory) =>
          inventory.remove({ paths: [h.checkout] }),
        ).pipe(Effect.provide(h.layer));
      h.setThreads([thread(h.checkout, true)]);
      expect((yield* remove()).results[0]?.outcome).toBe("running");
      h.setThreads([]);
      h.setDirty(true);
      expect((yield* remove()).results[0]?.outcome).toBe("dirty");
      expect(h.remove).not.toHaveBeenCalled();
      h.setDirty(false);
      expect((yield* remove()).results[0]?.outcome).toBe("removed");
      expect(h.remove).toHaveBeenCalledWith({ cwd: "/repo", path: h.checkout, force: false });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("protects project checkouts and refuses paths outside managed roots", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.setProject(h.checkout);
      const result = yield* Inventory.WorktreeInventory.use((inventory) =>
        inventory.remove({ paths: [h.checkout, "/repo", h.root] }),
      ).pipe(Effect.provide(h.layer));
      expect(result.results.map((entry) => entry.outcome)).toEqual([
        "not_managed",
        "not_managed",
        "not_managed",
      ]);
      expect(h.remove).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses symlink escapes and reports size unavailable without spawning", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const link = path.join(h.root, "repo", "link");
      yield* fs.symlink(h.checkout, link);
      const result = yield* Inventory.WorktreeInventory.use((inventory) =>
        inventory.remove({ paths: [link] }),
      ).pipe(Effect.provide(h.layer));
      expect(result.results[0]?.outcome).toBe("not_managed");
      expect(
        yield* Inventory.WorktreeInventory.use((inventory) => inventory.size(link)).pipe(
          Effect.provide(h.layer),
        ),
      ).toEqual({ bytes: null });
      expect(h.remove).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
