import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { UsageService } from "../../usage/UsageService.ts";
import { QueryToolkitHandlersLive } from "./handlers.ts";
import { QueryToolkit } from "./tools.ts";

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "query-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "query-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const TestLayer = McpServer.toolkit(QueryToolkit).pipe(
  Layer.provide(QueryToolkitHandlersLive),
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getDescriptor: Effect.succeed({
          environmentId: EnvironmentId.make("environment-query-test"),
          label: "Test machine",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        }),
      }),
      Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({}),
      Layer.mock(ProviderService)({}),
      Layer.mock(UsageService)({}),
    ),
  ),
  Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
);

// Today, in +01:00: 2026-09-29T23:00Z until 2026-09-30T23:00Z.
const TODAY = { since: "2026-09-30T00:00:00+01:00", until: "2026-10-01T00:00:00+01:00" };

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('project-web', 'Web app', '/work/web', '[{"id":"run","name":"Run","command":"make run"}]',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `;
  const thread = (
    id: string,
    title: string,
    options: {
      readonly latestUserMessageAt: string;
      readonly archivedAt?: string;
      readonly deletedAt?: string;
    },
  ) => sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, branch, model_selection_json, latest_user_message_at,
      archived_at, deleted_at, created_at, updated_at
    ) VALUES (
      ${id}, 'project-web', ${title}, 'main', '{"instanceId":"codex","model":"gpt-5"}',
      ${options.latestUserMessageAt}, ${options.archivedAt ?? null}, ${options.deletedAt ?? null},
      '2026-09-20T00:00:00.000Z', '2026-09-30T23:59:00.000Z'
    )
  `;
  yield* thread("thread-login", "Fix login", { latestUserMessageAt: "2026-09-30T23:30:00.000Z" });
  yield* thread("thread-old", "Old work", { latestUserMessageAt: "2026-09-28T10:00:00.000Z" });
  yield* thread("thread-archived", "Archived work", {
    latestUserMessageAt: "2026-09-30T10:00:00.000Z",
    archivedAt: "2026-09-30T11:00:00.000Z",
  });
  yield* thread("thread-deleted", "Deleted work", {
    latestUserMessageAt: "2026-09-30T10:00:00.000Z",
    deletedAt: "2026-09-30T12:00:00.000Z",
  });

  const message = (
    id: string,
    threadId: string,
    role: string,
    text: string,
    createdAt: string,
    turnId: string | null = null,
  ) => sql`
    INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
    VALUES (${id}, ${threadId}, ${turnId}, ${role}, ${text}, 0, ${createdAt}, ${createdAt})
  `;
  yield* message(
    "prompt-1",
    "thread-login",
    "user",
    "Fix the login redirect loop",
    "2026-09-30T09:00:00.000Z",
  );
  yield* message(
    "reasoning-1",
    "thread-login",
    "reasoning",
    "Thinking about the redirect",
    "2026-09-30T09:01:00.000Z",
    "turn-1",
  );
  yield* message(
    "reply-1",
    "thread-login",
    "assistant",
    "Fixed the redirect by checking the session first.",
    "2026-09-30T09:05:00.000Z",
    "turn-1",
  );
  yield* message("prompt-2", "thread-login", "user", "Now tidy up", "2026-09-30T23:30:00.000Z");
  yield* message("prompt-old", "thread-old", "user", "Old prompt", "2026-09-28T10:00:00.000Z");
  yield* message(
    "prompt-archived",
    "thread-archived",
    "user",
    "Archived prompt",
    "2026-09-30T10:00:00.000Z",
  );
  yield* message(
    "prompt-deleted",
    "thread-deleted",
    "user",
    "Deleted redirect prompt",
    "2026-09-30T10:00:00.000Z",
  );

  const turn = (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly promptId: string;
    readonly replyId: string | null;
    readonly count: number;
    readonly requestedAt: string;
    readonly completedAt: string;
    readonly files: string;
  }) => sql`
    INSERT INTO projection_turns (
      thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
      started_at, completed_at, checkpoint_turn_count, checkpoint_status, checkpoint_files_json
    ) VALUES (
      ${input.threadId}, ${input.turnId}, ${input.promptId}, ${input.replyId}, 'completed',
      ${input.requestedAt}, ${input.requestedAt}, ${input.completedAt}, ${input.count}, 'ready',
      ${input.files}
    )
  `;
  yield* turn({
    threadId: "thread-login",
    turnId: "turn-1",
    promptId: "prompt-1",
    replyId: "reply-1",
    count: 1,
    requestedAt: "2026-09-30T09:00:00.000Z",
    completedAt: "2026-09-30T09:05:00.000Z",
    files: '[{"path":"src/login.ts","kind":"modified","additions":10,"deletions":2}]',
  });
  yield* turn({
    threadId: "thread-login",
    turnId: "turn-2",
    promptId: "prompt-2",
    replyId: null,
    count: 2,
    requestedAt: "2026-09-30T23:30:00.000Z",
    completedAt: "2026-09-30T23:40:00.000Z",
    files:
      '[{"path":"src/login.ts","kind":"modified","additions":1,"deletions":1},{"path":"src/tidy.ts","kind":"added","additions":5,"deletions":0}]',
  });
  yield* turn({
    threadId: "thread-old",
    turnId: "turn-old",
    promptId: "prompt-old",
    replyId: null,
    count: 1,
    requestedAt: "2026-09-28T10:00:00.000Z",
    completedAt: "2026-09-28T10:10:00.000Z",
    files: "[]",
  });

  yield* sql`
    INSERT INTO projection_thread_pull_requests (thread_id, host, repository, number, url, source, linked_at, snapshot_json)
    VALUES ('thread-login', 'github.com', 'acme/web', 12, 'https://github.com/acme/web/pull/12', 'agent',
      '2026-09-30T09:10:00.000Z',
      '{"state":"open","title":"Fix login redirect","headBranch":"fix-login","baseBranch":"main","isDraft":false,"updatedAt":null,"syncedAt":"2026-09-30T09:11:00.000Z"}')
  `;
});

const call = (name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name, arguments: args })
      .pipe(Effect.provideService(McpSchema.McpServerClient, client));
    return result;
  });

const structured = (name: string, args: Record<string, unknown>) =>
  call(name, args).pipe(
    Effect.map((result) => {
      expect(result.isError).toBe(false);
      return result.structuredContent as Record<string, any>;
    }),
  );

describe("query toolkit", () => {
  it.effect("marks every tool read-only", () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      expect(server.tools.length).toBe(20);
      for (const { tool } of server.tools) {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
        expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("summarises the threads worked on in a window, hiding archived and deleted ones", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("list_threads", {
        activeSince: TODAY.since,
        activeUntil: TODAY.until,
      });
      expect(result.threads.map((thread: any) => thread.threadId)).toEqual(["thread-login"]);
      expect(result.threads[0]).toMatchObject({
        title: "Fix login",
        projectTitle: "Web app",
        provider: "codex",
        model: "gpt-5",
        turnCount: 2,
        pullRequests: [{ number: 12, state: "open", title: "Fix login redirect" }],
        window: {
          firstActivityAt: "2026-09-30T09:00:00.000Z",
          lastActivityAt: "2026-09-30T09:05:00.000Z",
          prompts: 1,
          turnsCompleted: 1,
          filesChanged: 1,
          additions: 10,
          deletions: 2,
        },
      });

      const withArchived = yield* structured("list_threads", {
        activeSince: TODAY.since,
        activeUntil: TODAY.until,
        archived: "include",
      });
      expect(withArchived.threads.map((thread: any) => thread.threadId).toSorted()).toEqual([
        "thread-archived",
        "thread-login",
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("pages threads by last activity with a cursor", () =>
    Effect.gen(function* () {
      yield* seed;
      const first = yield* structured("list_threads", { limit: 1 });
      expect(first.threads.map((thread: any) => thread.threadId)).toEqual(["thread-login"]);
      expect(first.threads[0].lastActivityAt).toBe("2026-09-30T23:40:00.000Z");
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = yield* structured("list_threads", { limit: 1, cursor: first.nextCursor });
      expect(second.threads.map((thread: any) => thread.threadId)).toEqual(["thread-old"]);
      expect(second.nextCursor).toBeNull();

      const oldestFirst = yield* structured("list_threads", { order: "asc" });
      expect(oldestFirst.threads.map((thread: any) => thread.threadId)).toEqual([
        "thread-old",
        "thread-login",
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("orders the timeline and honours until as a hard cutoff", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("get_activity_timeline", { ...TODAY, order: "asc" });
      // Archived threads are still history; deleted ones are gone.
      expect(result.entries.map((entry: any) => [entry.kind, entry.id])).toEqual([
        ["prompt", "prompt-1"],
        ["turn.completed", "turn-1"],
        ["pull_request.linked", "https://github.com/acme/web/pull/12"],
        ["prompt", "prompt-archived"],
        ["thread.archived", "thread-archived"],
      ]);
      expect(result.entries[1].summary).toBe(
        "completed · 1 files +10 -2 · Fixed the redirect by checking the session first.",
      );

      const prompts = yield* structured("get_activity_timeline", {
        since: TODAY.since,
        kinds: ["prompt"],
      });
      expect(prompts.entries.map((entry: any) => entry.id)).toEqual([
        "prompt-2",
        "prompt-archived",
        "prompt-1",
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists messages by role and keeps reasoning out unless asked", () =>
    Effect.gen(function* () {
      yield* seed;
      const asked = yield* structured("list_messages", { ...TODAY, role: "user" });
      expect(asked.messages.map((message: any) => message.messageId)).toEqual([
        "prompt-archived",
        "prompt-1",
      ]);

      const all = yield* structured("list_messages", { threadId: "thread-login", ...TODAY });
      expect(all.messages.map((message: any) => message.messageId)).toEqual([
        "reply-1",
        "prompt-1",
      ]);

      const withReasoning = yield* structured("list_messages", {
        threadId: "thread-login",
        ...TODAY,
        includeReasoning: true,
        maxChars: 100,
      });
      expect(withReasoning.messages.map((message: any) => message.messageId)).toEqual([
        "reply-1",
        "reasoning-1",
        "prompt-1",
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("searches live threads only", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("search", { query: "redirect" });
      expect(result.messages.map((message: any) => message.messageId)).toEqual([
        "reply-1",
        "prompt-1",
      ]);
      expect(result.messages[1].snippet).toBe("Fix the login redirect loop");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("sums a range of turns into one file list", () =>
    Effect.gen(function* () {
      yield* seed;
      const oneTurn = yield* structured("get_turn_diff", {
        threadId: "thread-login",
        turnId: "turn-1",
      });
      expect(oneTurn).toMatchObject({ fromTurnCount: 0, toTurnCount: 1, patch: null });

      const range = yield* structured("get_turn_diff", {
        threadId: "thread-login",
        fromTurnCount: 0,
        toTurnCount: 2,
      });
      expect(range.files).toEqual([
        { path: "src/login.ts", kind: "modified", additions: 11, deletions: 3 },
        { path: "src/tidy.ts", kind: "added", additions: 5, deletions: 0 },
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects times without an offset and unknown ids", () =>
    Effect.gen(function* () {
      yield* seed;
      const server = yield* McpServer.McpServer;
      const invalid = yield* server
        .callTool({ name: "list_threads", arguments: { activeSince: "2026-09-30" } })
        .pipe(Effect.provideService(McpSchema.McpServerClient, client), Effect.flip);
      expect(invalid._tag).toBe("InvalidParams");

      const missing = yield* call("get_thread", { threadId: "thread-deleted" });
      expect(missing.isError).toBe(true);
      expect(missing.content[0]).toMatchObject({
        text: "No thread thread-deleted was found. It may have been deleted.",
      });
    }).pipe(Effect.provide(TestLayer)),
  );
});
