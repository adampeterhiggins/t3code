import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { UsageService } from "../../usage/UsageService.ts";
import { toolkitRegistration } from "../McpHttpServer.ts";
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

const TestLayer = toolkitRegistration(QueryToolkit, QueryToolkitHandlersLive).pipe(
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
      Layer.mock(UsageService)({}),
    ),
  ),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
);

// Today, in +01:00: 2026-09-29T23:00Z until 2026-09-30T23:00Z.
const TODAY = { since: "2026-09-30T00:00:00+01:00", until: "2026-10-01T00:00:00+01:00" };
const LONG_TEXT = `Please refactor the session store. ${"x".repeat(450)}`;

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
      readonly archivedAt?: string;
      readonly deletedAt?: string;
      readonly payload?: Record<string, unknown>;
    } = {},
  ) => sql`
    INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, provider_instance_id, runtime_mode,
      interaction_mode, created_at, updated_at, archived_at, deleted_at, payload_json
    ) VALUES (
      ${id}, 'project-web', ${title}, 'codex', 'codex', 'full-access', 'default',
      '2026-09-20T00:00:00.000Z', '2026-09-30T23:59:00.000Z', ${options.archivedAt ?? null},
      ${options.deletedAt ?? null},
      ${JSON.stringify({
        branch: "main",
        worktreePath: null,
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
        settledAt: null,
        settledOverride: null,
        ...options.payload,
      })}
    )
  `;
  yield* thread("thread-login", "Fix login", {
    payload: {
      startedBy: { kind: "agent-access", label: "Claude Desktop" },
      pullRequests: [
        {
          host: "github.com",
          repository: "acme/web",
          number: 12,
          url: "https://github.com/acme/web/pull/12",
          source: "agent",
          linkedAt: "2026-09-30T09:10:00.000Z",
          snapshot: {
            state: "open",
            title: "Fix login redirect",
            headBranch: "fix-login",
            baseBranch: "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-09-30T09:11:00.000Z",
          },
          stack: null,
        },
      ],
    },
  });
  yield* thread("thread-old", "Old work", {
    payload: { startedBy: { kind: "thread", threadId: "thread-login" } },
  });
  yield* thread("thread-archived", "Archived work", { archivedAt: "2026-09-30T11:00:00.000Z" });
  yield* thread("thread-deleted", "Deleted work", { deletedAt: "2026-09-30T12:00:00.000Z" });
  yield* thread("thread-imported", "Imported work", { payload: { historyOrigin: "v1_import" } });
  yield* thread("thread-sub", "Subagent work", {
    payload: {
      lineage: {
        parentThreadId: "thread-login",
        relationshipToParent: "subagent",
        rootThreadId: "thread-login",
      },
    },
  });

  const message = (
    id: string,
    threadId: string,
    role: string,
    text: string,
    createdAt: string,
    runId: string | null = null,
  ) => sql`
    INSERT INTO orchestration_v2_projection_messages (
      message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json
    ) VALUES (
      ${id}, ${threadId}, ${runId}, NULL, ${role}, 0, ${createdAt}, ${createdAt},
      ${JSON.stringify({ text, attachments: [], createdBy: role === "user" ? "user" : "agent" })}
    )
  `;
  yield* message(
    "prompt-1",
    "thread-login",
    "user",
    "Fix the login redirect loop",
    "2026-09-30T09:00:00.000Z",
    "run-1",
  );
  yield* message(
    "reply-1",
    "thread-login",
    "assistant",
    "Fixed the redirect by checking the session first.",
    "2026-09-30T09:05:00.000Z",
    "run-1",
  );
  yield* message(
    "prompt-2",
    "thread-login",
    "user",
    LONG_TEXT,
    "2026-09-30T23:30:00.000Z",
    "run-2",
  );
  yield* message(
    "prompt-old",
    "thread-old",
    "user",
    "Old prompt",
    "2026-09-28T10:00:00.000Z",
    "run-old",
  );
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
  yield* message(
    "imported-1",
    "thread-imported",
    "user",
    "Imported question",
    "2026-09-30T10:00:00.000Z",
  );
  yield* message(
    "imported-2",
    "thread-imported",
    "assistant",
    "Imported answer",
    "2026-09-30T10:01:00.000Z",
  );
  yield* message("sub-prompt", "thread-sub", "user", "Look into it", "2026-09-30T09:02:00.000Z");

  const run = (input: {
    readonly id: string;
    readonly threadId: string;
    readonly ordinal: number;
    readonly status: string;
    readonly requestedAt: string;
    readonly completedAt: string | null;
    readonly userMessageId: string;
    readonly sourcePlanId?: string;
  }) => sql`
    INSERT INTO orchestration_v2_projection_runs (
      run_id, thread_id, ordinal, provider, provider_instance_id, status, requested_at,
      completed_at, payload_json
    ) VALUES (
      ${input.id}, ${input.threadId}, ${input.ordinal}, 'codex', 'codex', ${input.status},
      ${input.requestedAt}, ${input.completedAt},
      ${JSON.stringify({
        userMessageId: input.userMessageId,
        startedAt: input.requestedAt,
        checkpointId: null,
        ...(input.sourcePlanId === undefined
          ? {}
          : { sourcePlanRef: { threadId: input.threadId, planId: input.sourcePlanId } }),
      })}
    )
  `;
  yield* run({
    id: "run-1",
    threadId: "thread-login",
    ordinal: 1,
    status: "completed",
    requestedAt: "2026-09-30T09:00:00.000Z",
    completedAt: "2026-09-30T09:05:00.000Z",
    userMessageId: "prompt-1",
  });
  yield* run({
    id: "run-2",
    threadId: "thread-login",
    ordinal: 2,
    status: "waiting",
    requestedAt: "2026-09-30T23:30:00.000Z",
    completedAt: null,
    userMessageId: "prompt-2",
    sourcePlanId: "plan-1",
  });
  yield* run({
    id: "run-old",
    threadId: "thread-old",
    ordinal: 1,
    status: "completed",
    requestedAt: "2026-09-28T10:00:00.000Z",
    completedAt: "2026-09-28T10:10:00.000Z",
    userMessageId: "prompt-old",
  });

  yield* sql`
    INSERT INTO orchestration_v2_projection_checkpoints (
      checkpoint_id, thread_id, scope_id, run_id, node_id, ordinal_within_scope, app_run_ordinal,
      status, captured_at, payload_json
    ) VALUES (
      'checkpoint-1', 'thread-login', 'scope-login', 'run-1', 'node-run-1', 1, 1, 'ready',
      '2026-09-30T09:05:00.000Z',
      '{"files":[{"path":"src/login.ts","kind":"modified","additions":10,"deletions":2}]}'
    )
  `;
  yield* sql`
    INSERT INTO orchestration_v2_projection_nodes (
      node_id, thread_id, run_id, root_node_id, kind, status, payload_json
    ) VALUES ('node-approval', 'thread-login', 'run-2', 'node-run-2', 'approval', 'waiting', '{}')
  `;

  const item = (input: {
    readonly id: string;
    readonly threadId: string;
    readonly runId: string | null;
    readonly ordinal: number;
    readonly type: string;
    readonly status?: string;
    readonly at: string;
    readonly payload: Record<string, unknown>;
  }) => sql`
    INSERT INTO orchestration_v2_projection_turn_items (
      turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json
    ) VALUES (
      ${input.id}, ${input.threadId}, ${input.runId}, ${input.ordinal}, ${input.type},
      ${input.status ?? "completed"}, ${input.at},
      ${JSON.stringify({ title: null, startedAt: input.at, ...input.payload })}
    )
  `;
  yield* item({
    id: "item-reasoning",
    threadId: "thread-login",
    runId: "run-1",
    ordinal: 1,
    type: "reasoning",
    at: "2026-09-30T09:01:00.000Z",
    payload: { text: "Thinking about the redirect", streaming: false },
  });
  yield* item({
    id: "item-command",
    threadId: "thread-login",
    runId: "run-1",
    ordinal: 2,
    type: "command_execution",
    at: "2026-09-30T09:02:00.000Z",
    payload: { input: "npm test", output: "ok" },
  });
  yield* item({
    id: "item-plan",
    threadId: "thread-login",
    runId: "run-1",
    ordinal: 3,
    type: "proposed_plan",
    at: "2026-09-30T09:03:00.000Z",
    payload: {
      planId: "plan-1",
      markdown: "# Fix the redirect\n\nCheck the session.",
      streaming: false,
    },
  });
  yield* item({
    id: "item-error",
    threadId: "thread-login",
    runId: "run-1",
    ordinal: 4,
    type: "error",
    status: "failed",
    at: "2026-09-30T09:04:00.000Z",
    payload: { failure: { class: "provider_error", message: "Rate limited" } },
  });
  yield* item({
    id: "item-subagent",
    threadId: "thread-login",
    runId: "run-1",
    ordinal: 5,
    type: "subagent",
    at: "2026-09-30T09:02:30.000Z",
    payload: { subagentId: "subagent-1", childThreadId: "thread-sub", prompt: "Look into it" },
  });
  yield* item({
    id: "item-approval",
    threadId: "thread-login",
    runId: "run-2",
    ordinal: 1,
    type: "approval_request",
    status: "waiting",
    at: "2026-09-30T23:31:00.000Z",
    payload: {
      requestId: "request-approval",
      requestKind: "command",
      prompt: "Run rm -rf build?",
      options: [{ decision: "accept", label: "Allow" }],
    },
  });
  yield* item({
    id: "sub-user",
    threadId: "thread-sub",
    runId: null,
    ordinal: 1,
    type: "user_message",
    at: "2026-09-30T09:02:00.000Z",
    payload: { text: "Look into it" },
  });
  yield* item({
    id: "sub-command",
    threadId: "thread-sub",
    runId: null,
    ordinal: 2,
    type: "command_execution",
    at: "2026-09-30T09:02:10.000Z",
    payload: { input: "rg redirect", output: "src/login.ts" },
  });
  yield* item({
    id: "sub-reply",
    threadId: "thread-sub",
    runId: null,
    ordinal: 3,
    type: "assistant_message",
    at: "2026-09-30T09:02:20.000Z",
    payload: { text: "The loop is in src/login.ts.", streaming: false },
  });

  yield* sql`
    INSERT INTO orchestration_v2_projection_subagents (
      subagent_id, thread_id, run_id, parent_node_id, provider, child_thread_id, origin, status,
      started_at, completed_at, updated_at, payload_json
    ) VALUES (
      'subagent-1', 'thread-login', 'run-1', 'node-run-1', 'codex', 'thread-sub', 'provider_native',
      'completed', '2026-09-30T09:02:00.000Z', '2026-09-30T09:02:30.000Z', '2026-09-30T09:02:30.000Z',
      '{"prompt":"Look into it","title":"Explorer","result":"The loop is in src/login.ts."}'
    )
  `;

  const plan = (id: string, runId: string, status: string, markdown: string) => sql`
    INSERT INTO orchestration_v2_projection_plans (plan_id, thread_id, run_id, node_id, kind, status, payload_json)
    VALUES (${id}, 'thread-login', ${runId}, 'node-plan', 'proposed_plan', ${status},
      ${JSON.stringify({ markdown })})
  `;
  yield* plan("plan-1", "run-1", "completed", "# Fix the redirect\n\nCheck the session.");
  yield* plan("plan-2", "run-2", "active", "# Tidy up\n\nRemove dead code.");

  const request = (id: string, kind: string, createdAt: string) => sql`
    INSERT INTO orchestration_v2_projection_runtime_requests (
      runtime_request_id, thread_id, node_id, kind, status, created_at, payload_json
    ) VALUES (${id}, 'thread-login', 'node-approval', ${kind}, 'pending', ${createdAt}, '{}')
  `;
  yield* request("request-approval", "command", "2026-09-30T23:31:00.000Z");
  yield* request("request-question", "user_input", "2026-09-30T23:32:00.000Z");
});

const call = (name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(Effect.provideService(McpSchema.McpServerClient, client));
  });

const structured = (name: string, args: Record<string, unknown>) =>
  call(name, args).pipe(
    Effect.map((result) => {
      expect(result.isError, JSON.stringify(result.content)).toBe(false);
      return result.structuredContent as Record<string, any>;
    }),
  );

const ids = (items: ReadonlyArray<Record<string, any>>, key: string) =>
  items.map((item) => item[key]);

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

  it.effect(
    "summarises the threads worked on in a window, hiding archived, deleted and subagent ones",
    () =>
      Effect.gen(function* () {
        yield* seed;
        const result = yield* structured("list_threads", {
          activeSince: TODAY.since,
          activeUntil: TODAY.until,
        });
        expect(ids(result.threads, "threadId")).toEqual(["thread-imported", "thread-login"]);
        expect(result.threads[1]).toMatchObject({
          title: "Fix login",
          projectTitle: "Web app",
          provider: "codex",
          model: "gpt-5",
          branch: "main",
          sessionStatus: "waiting",
          turnCount: 2,
          pendingApprovalCount: 1,
          pendingUserInputCount: 1,
          hasActionableProposedPlan: true,
          startedBy: { kind: "agent-access", label: "Claude Desktop" },
          startedByThreadId: null,
          importedFromV1: false,
          pullRequests: [{ number: 12, state: "open", title: "Fix login redirect" }],
          pullRequestCount: 1,
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
        expect(result.threads[0]).toMatchObject({
          importedFromV1: true,
          sessionStatus: "idle",
          turnCount: 0,
          window: { prompts: 1, turnsCompleted: 0 },
        });

        const all = yield* structured("list_threads", { archived: "include", order: "asc" });
        expect(ids(all.threads, "threadId")).toEqual([
          "thread-old",
          "thread-archived",
          "thread-imported",
          "thread-login",
        ]);
        expect(all.threads[0]).toMatchObject({
          startedBy: { kind: "thread", threadId: "thread-login" },
          startedByThreadId: "thread-login",
          sessionStatus: "completed",
        });

        const waiting = yield* structured("list_threads", { needsAttention: true });
        expect(ids(waiting.threads, "threadId")).toEqual(["thread-login"]);
        const linked = yield* structured("list_threads", { hasPullRequest: true });
        expect(ids(linked.threads, "threadId")).toEqual(["thread-login"]);
      }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("details a thread with its pending approvals, plans and changed files", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("get_thread", { threadId: "thread-login" });
      expect(result.pendingApprovals).toEqual([
        {
          requestId: "request-approval",
          turnId: "run-2",
          kind: "command",
          prompt: "Run rm -rf build?",
          options: [{ decision: "accept", label: "Allow" }],
          createdAt: "2026-09-30T23:31:00.000Z",
        },
      ]);
      expect(result.counts).toEqual({
        messagesByRole: { user: 2, assistant: 1 },
        activitiesByTone: { tool: 2, info: 1, error: 1, approval: 1 },
      });
      expect(result.firstPrompt).toBe("Fix the login redirect loop");
      expect(result.latestResponse).toBe("Fixed the redirect by checking the session first.");
      expect(result.changedFiles).toEqual([
        { path: "src/login.ts", kind: "modified", additions: 10, deletions: 2 },
      ]);
      expect(
        result.plans.map((plan: any) => [plan.planId, plan.status, plan.implementedAt]),
      ).toEqual([
        ["plan-2", "active", null],
        ["plan-1", "completed", "2026-09-30T23:30:00.000Z"],
      ]);
      expect(result.plans[1]).toMatchObject({
        title: "Fix the redirect",
        createdAt: "2026-09-30T09:03:00.000Z",
        implementationThreadId: "thread-login",
      });

      // A subagent's own thread is still reachable by id.
      const child = yield* structured("get_thread", { threadId: "thread-sub" });
      expect(child.thread.title).toBe("Subagent work");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists messages by role, pages them with a cursor and cuts long text", () =>
    Effect.gen(function* () {
      yield* seed;
      const asked = yield* structured("list_messages", { ...TODAY, role: "user" });
      expect(ids(asked.messages, "messageId")).toEqual([
        "prompt-archived",
        "imported-1",
        "prompt-1",
      ]);
      expect(asked.messages[2]).toMatchObject({ turnId: "run-1", createdBy: "user" });

      const first = yield* structured("list_messages", { role: "user", limit: 2 });
      expect(ids(first.messages, "messageId")).toEqual(["prompt-2", "prompt-archived"]);
      const second = yield* structured("list_messages", {
        role: "user",
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(ids(second.messages, "messageId")).toEqual(["imported-1", "prompt-1"]);
      const third = yield* structured("list_messages", {
        role: "user",
        limit: 2,
        cursor: second.nextCursor,
      });
      expect(ids(third.messages, "messageId")).toEqual(["prompt-old"]);
      expect(third.nextCursor).toBeNull();

      expect(first.messages[0].truncated).toBe(false);
      const cut = yield* structured("list_messages", {
        threadId: "thread-login",
        role: "user",
        maxChars: 100,
        limit: 1,
      });
      expect(cut.messages[0].truncated).toBe(true);
      expect(cut.messages[0].text).toBe(`${LONG_TEXT.slice(0, 100)}…`);

      const withReasoning = yield* structured("list_messages", {
        threadId: "thread-login",
        ...TODAY,
        includeReasoning: true,
      });
      expect(ids(withReasoning.messages, "messageId")).toEqual([
        "reply-1",
        "item-reasoning",
        "prompt-1",
      ]);
      expect(withReasoning.messages[1].role).toBe("reasoning");

      const full = yield* structured("get_message", { messageId: "prompt-2" });
      expect(full.message.text).toBe(LONG_TEXT);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists turns from runs with their prompt, reply and checkpoint files", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("list_turns", { threadId: "thread-login" });
      expect(ids(result.turns, "turnId")).toEqual(["run-2", "run-1"]);
      expect(result.turns[1]).toMatchObject({
        turnCount: 1,
        state: "completed",
        prompt: "Fix the login redirect loop",
        response: "Fixed the redirect by checking the session first.",
        fileCount: 1,
        additions: 10,
        deletions: 2,
      });
      expect(result.turns[0]).toMatchObject({
        turnCount: null,
        state: "waiting",
        sourcePlanId: "plan-1",
        truncated: true,
      });

      const turn = yield* structured("get_turn", { threadId: "thread-login", turnId: "run-1" });
      expect(turn.activityCounts).toEqual({
        command_execution: 1,
        proposed_plan: 1,
        error: 1,
        subagent: 1,
      });
      expect(ids(turn.notableActivities, "activityId")).toEqual([
        "item-command",
        "item-plan",
        "item-error",
        "item-subagent",
      ]);

      const diff = yield* structured("get_turn_diff", {
        threadId: "thread-login",
        turnId: "run-1",
      });
      expect(diff).toMatchObject({
        fromTurnCount: 0,
        toTurnCount: 1,
        patch: null,
        files: [{ path: "src/login.ts", additions: 10, deletions: 2 }],
      });
      const noCheckpoint = yield* call("get_turn_diff", {
        threadId: "thread-login",
        turnId: "run-2",
      });
      expect(noCheckpoint.isError).toBe(true);

      const imported = yield* structured("list_turns", { threadId: "thread-imported" });
      expect(imported.turns).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists activities from turn items, filtered by tone and kind", () =>
    Effect.gen(function* () {
      yield* seed;
      const all = yield* structured("list_activities", { threadId: "thread-login", order: "asc" });
      expect(ids(all.activities, "activityId")).toEqual([
        "item-command",
        "item-subagent",
        "item-plan",
        "item-error",
        "item-approval",
      ]);
      expect(all.activities[0]).toMatchObject({
        turnId: "run-1",
        tone: "tool",
        kind: "command_execution",
        status: "completed",
        summary: "Command",
        detail: "npm test",
        createdAt: "2026-09-30T09:02:00.000Z",
      });
      expect(all.activities[3]).toMatchObject({ tone: "error", detail: "Rate limited" });

      const tools = yield* structured("list_activities", {
        threadId: "thread-login",
        tone: "tool",
      });
      expect(ids(tools.activities, "activityId")).toEqual(["item-subagent", "item-command"]);
      const errors = yield* structured("list_activities", { kinds: ["error"] });
      expect(ids(errors.activities, "activityId")).toEqual(["item-error"]);

      const activity = yield* structured("get_activity", { activityId: "item-command" });
      expect(activity.payload).toMatchObject({ input: "npm test", output: "ok" });

      const transcript = yield* structured("get_subagent_transcript", {
        threadId: "thread-login",
        taskId: "item-subagent",
      });
      expect(transcript).toMatchObject({
        taskId: "subagent-1",
        childThreadId: "thread-sub",
        status: "completed",
        result: "The loop is in src/login.ts.",
        truncated: false,
      });
      expect(
        transcript.entries.map((entry: any) => [entry.kind, entry.input ?? entry.text]),
      ).toEqual([
        ["user", "Look into it"],
        ["tool", "rg redirect"],
        ["assistant", "The loop is in src/login.ts."],
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists plans and returns one in full", () =>
    Effect.gen(function* () {
      yield* seed;
      const built = yield* structured("list_plans", { implemented: true });
      expect(ids(built.plans, "planId")).toEqual(["plan-1"]);
      const open = yield* structured("list_plans", { implemented: false });
      expect(ids(open.plans, "planId")).toEqual(["plan-2"]);

      const plan = yield* structured("get_plan", { planId: "plan-1", maxChars: 100 });
      expect(plan).toMatchObject({
        markdown: "# Fix the redirect\n\nCheck the session.",
        truncated: false,
        plan: { threadTitle: "Fix login", turnId: "run-1" },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("searches live threads only", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("search", { query: "redirect" });
      expect(ids(result.messages, "messageId")).toEqual(["reply-1", "prompt-1"]);
      expect(result.messages[1].snippet).toBe("Fix the login redirect loop");

      const titles = yield* structured("search", { query: "imported" });
      expect(ids(titles.threads, "threadId")).toEqual(["thread-imported"]);
      expect(ids(titles.messages, "messageId")).toEqual(["imported-2", "imported-1"]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("orders the timeline and honours until as a hard cutoff", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* structured("get_activity_timeline", { ...TODAY, order: "asc" });
      // Archived threads are still history; deleted and subagent ones are not listed.
      expect(result.entries.map((entry: any) => [entry.kind, entry.id])).toEqual([
        ["prompt", "prompt-1"],
        ["plan.proposed", "plan-1"],
        ["error", "item-error"],
        ["turn.completed", "run-1"],
        ["pull_request.linked", "https://github.com/acme/web/pull/12"],
        ["prompt", "imported-1"],
        ["prompt", "prompt-archived"],
        ["thread.archived", "thread-archived"],
      ]);
      expect(result.entries[3].summary).toBe(
        "completed · 1 files +10 -2 · Fixed the redirect by checking the session first.",
      );

      const later = yield* structured("get_activity_timeline", {
        since: TODAY.since,
        kinds: ["plan.implemented", "approval.requested"],
      });
      expect(later.entries.map((entry: any) => [entry.kind, entry.id, entry.turnId])).toEqual([
        ["approval.requested", "request-approval", "run-2"],
        ["plan.implemented", "plan-1", "run-1"],
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
