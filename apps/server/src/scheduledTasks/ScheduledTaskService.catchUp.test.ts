import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, vi } from "vite-plus/test";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

afterEach(() => vi.unstubAllEnvs());

const fixedTime = (timeOfDay: string, catchUpMissed?: boolean) =>
  JSON.stringify({
    type: "fixed_time",
    timeOfDay,
    ...(catchUpMissed === undefined ? {} : { catchUpMissed }),
  });

it.effect(
  "catches up only a same-day missed run, and never one a restart interrupted or a paused task",
  () =>
    Effect.gen(function* () {
      // Europe/London is on BST (UTC+1) in July.
      vi.stubEnv("TZ", "Europe/London");
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-07-01T12:00:00.000Z"; // 13:00 local
      const rows = [
        // Missed yesterday at 14:00 local; today's 14:00 is still ahead.
        {
          id: "a-next-day",
          schedule: fixedTime("14:00", true),
          next: "2026-06-30T13:00:00.000Z",
        },
        // Missed this morning, but the task does not catch up.
        { id: "b-no-catch-up", schedule: fixedTime("09:00"), next: "2026-07-01T08:00:00.000Z" },
        {
          id: "c-paused",
          schedule: fixedTime("09:00", true),
          next: "2026-07-01T08:00:00.000Z",
          enabled: 0,
        },
        // Missed this morning: runs once now.
        {
          id: "d-catch-up",
          schedule: fixedTime("09:30", true),
          next: "2026-07-01T08:30:00.000Z",
        },
        // A catch-up run the server died in the middle of must not run again.
        {
          id: "e-interrupted",
          schedule: fixedTime("09:00", true),
          next: "2026-07-01T08:00:00.000Z",
          status: "running",
        },
      ];
      for (const row of rows) {
        yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
          task_id: row.id,
          title: row.id,
          prompt: "Write the brief.",
          enabled: row.enabled ?? 1,
          schedule_json: row.schedule,
          project_id: "project:test",
          thread_id: null,
          workspace_strategy_json: '{"type":"root"}',
          model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          created_by: "user",
          creation_source: "web",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          next_run_at: row.next,
          last_run_at: row.status === "running" ? row.next : null,
          last_run_status: row.status ?? "never",
          last_run_error: null,
          run_count: 0,
        })}`;
      }
      yield* TestClock.setTime(Date.parse(now));

      const launched = yield* Ref.make<ReadonlyArray<string>>([]);
      const dispatched = yield* Deferred.make<void>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            Layer.provideMerge(
              ScheduledTaskService.layer,
              Layer.mergeAll(
                Layer.mock(ThreadLaunchService.ThreadLaunchService)({
                  launch: (input) =>
                    Ref.update(launched, (ids) => [...ids, input.commandId]).pipe(
                      Effect.andThen(Deferred.succeed(dispatched, undefined)),
                      Effect.andThen(Effect.die(new Error("test launch stops here"))),
                    ),
                }),
                Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                  namedProjectsRoot: "/projects",
                  isScratchProject: () => Effect.succeed(false),
                }),
                Layer.mock(ThreadManagementService.ThreadManagementService)({}),
                Layer.mock(SecretRequests.SecretRequests)({}),
                NodeCrypto.layer,
                Scheduler.layer,
              ),
            ),
          );
          yield* TestClock.adjust("6 seconds");
          // Due rows run in next_run_at order, so the catch-up dispatch comes
          // after every earlier row has been skipped or rescheduled.
          yield* Deferred.await(dispatched);
        }),
      );

      const commandIds = yield* Ref.get(launched);
      assert.equal(commandIds.length, 1);
      assert.match(commandIds[0] ?? "", /^scheduled-task:d-catch-up:\d+:catch_up$/);

      const stored = yield* sql<{
        task_id: string;
        next_run_at: string | null;
        last_run_status: string;
        run_count: number;
      }>`SELECT task_id, next_run_at, last_run_status, run_count FROM scheduled_tasks`;
      const byId = new Map(stored.map((row) => [row.task_id, row]));
      assert.equal(byId.get("a-next-day")?.next_run_at, "2026-07-01T13:00:00.000Z");
      assert.equal(byId.get("a-next-day")?.run_count, 0);
      assert.equal(byId.get("b-no-catch-up")?.next_run_at, "2026-07-02T08:00:00.000Z");
      assert.equal(byId.get("b-no-catch-up")?.run_count, 0);
      assert.equal(byId.get("c-paused")?.next_run_at, "2026-07-01T08:00:00.000Z");
      assert.equal(byId.get("c-paused")?.last_run_status, "never");
      assert.equal(byId.get("e-interrupted")?.last_run_status, "failed");
      assert.equal(byId.get("e-interrupted")?.next_run_at, "2026-07-02T08:00:00.000Z");
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
