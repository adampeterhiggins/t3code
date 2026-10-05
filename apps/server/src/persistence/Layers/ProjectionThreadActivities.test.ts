import { EventId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadActivityRepository } from "../Services/ProjectionThreadActivities.ts";
import { ProjectionThreadActivityRepositoryLive } from "./ProjectionThreadActivities.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadActivityRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadActivityRepository", (it) => {
  it.effect("reads only the latest matching task activity", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadActivityRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-latest-task-activity");

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        VALUES
          (
            'activity-task-unrelated-tool', ${threadId}, NULL, 'tool', 'tool.completed',
            'large tool output', 'not-json', 1, '2026-03-01T00:00:00.000Z'
          ),
          (
            'activity-task-started', ${threadId}, NULL, 'info', 'task.started',
            'started', '{"taskId":"task-1","title":"Initial title"}', 2,
            '2026-03-01T00:00:01.000Z'
          ),
          (
            'activity-task-progress', ${threadId}, NULL, 'info', 'task.progress',
            'progress', '{"taskId":"task-1","title":"Updated title"}', 3,
            '2026-03-01T00:00:02.000Z'
          ),
          (
            'activity-task-other', ${threadId}, NULL, 'info', 'task.progress',
            'other', '{"taskId":"task-2","title":"Other title"}', 4,
            '2026-03-01T00:00:03.000Z'
          )
      `;

      yield* repository.upsert({
        activityId: EventId.make("activity-task-untitled"),
        threadId,
        turnId: null,
        tone: "info",
        kind: "task.progress",
        summary: "Still running",
        payload: { taskId: "task-1" },
        sequence: 5,
        createdAt: "2026-03-01T00:00:04.000Z",
      });
      yield* repository.upsert({
        activityId: EventId.make("activity-task-blank-title"),
        threadId,
        turnId: null,
        tone: "info",
        kind: "task.progress",
        summary: "Still running",
        payload: { taskId: "task-1", title: " \t\n\u00a0" },
        sequence: 6,
        createdAt: "2026-03-01T00:00:05.000Z",
      });

      const recent = yield* repository.listByThreadId({
        threadId,
        activityKinds: ["task.progress"],
        limit: 2,
      });
      assert.deepEqual(
        recent.map((entry) => entry.activityId),
        ["activity-task-untitled", "activity-task-blank-title"],
      );

      const activity = yield* repository.getLatestTaskActivity({
        threadId,
        taskId: "task-1",
      });
      assert.equal(activity._tag, "Some");
      if (activity._tag === "Some") {
        assert.equal(activity.value.activityId, EventId.make("activity-task-progress"));
        assert.deepEqual(activity.value.payload, {
          taskId: "task-1",
          title: "Updated title",
        });
      }

      assert.equal(
        (yield* repository.getLatestTaskActivity({ threadId, taskId: "missing" }))._tag,
        "None",
      );
    }),
  );

  it.effect("reads a task's spawn time past replaced progress rows", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadActivityRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-task-spawned-at");

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        VALUES
          (
            'activity-started', ${threadId}, NULL, 'info', 'task.started',
            'started', '{"taskId":"task-started"}', NULL, '2026-03-01T00:00:01.000Z'
          ),
          (
            'activity-started-progress', ${threadId}, NULL, 'info', 'task.progress',
            'progress', '{"taskId":"task-started"}', NULL, '2026-03-01T00:10:00.000Z'
          ),
          (
            'activity-stamped-progress', ${threadId}, NULL, 'info', 'task.progress',
            'progress', '{"taskId":"task-stamped","spawnedAt":"2026-03-01T00:00:02.000Z"}',
            NULL, '2026-03-01T00:10:01.000Z'
          )
      `;

      const spawnedAt = (taskId: string) => repository.getTaskSpawnedAt({ threadId, taskId });
      assert.deepEqual(yield* spawnedAt("task-started"), Option.some("2026-03-01T00:00:01.000Z"));
      assert.deepEqual(yield* spawnedAt("task-stamped"), Option.some("2026-03-01T00:00:02.000Z"));
      assert.deepEqual(yield* spawnedAt("missing"), Option.none());
    }),
  );
});
