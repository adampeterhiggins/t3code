// node:sqlite builds a Conductor database fixture on disk.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { ThreadTabs } from "../threadTabs/ThreadTabs.ts";
import * as ConductorImporter from "./ConductorImporter.ts";
import { parseConductorTranscript } from "./conductorDatabase.ts";

const projectId = ProjectId.make("conductor-import-project");
const claudeSessionId = "5922d31b-8896-46d8-bc77-1107fc22b749";

function assistant(content: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", model: "claude-fable-5-1", content },
    ...extra,
  });
}

/** A Conductor clone of the project's repository with one workspace of three tabs. */
function makeFixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "conductor-import-"));
  const projectRoot = NodePath.join(root, "project");
  const workspacePath = NodePath.join(root, "conductor", "orchestra", ".conductor", "yaounde");
  NodeFS.mkdirSync(NodePath.join(projectRoot, ".git"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(projectRoot, ".git", "config"),
    '[remote "origin"]\n\turl = git@github.com:focaldata/orchestra.git\n',
  );
  NodeFS.mkdirSync(workspacePath, { recursive: true });

  const databasePath = NodePath.join(root, "conductor.db");
  const db = new NodeSqlite.DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE repos (id TEXT PRIMARY KEY, remote_url TEXT, root_path TEXT);
    CREATE TABLE workspaces (local_id TEXT PRIMARY KEY, repository_id TEXT, directory_name TEXT,
      branch TEXT, state TEXT, workspace_path TEXT, pinned_at TEXT, updated_at TEXT,
      workspace_name TEXT, pr_title TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, agent_type TEXT,
      claude_session_id TEXT, model TEXT, is_hidden INTEGER, created_at TEXT);
    CREATE TABLE session_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      created_at TEXT, sent_at TEXT, cancelled_at TEXT);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, type TEXT, original_name TEXT, path TEXT,
      session_id TEXT, session_message_id TEXT, is_draft INTEGER, comment_id TEXT);
    CREATE TABLE diff_comments (id TEXT PRIMARY KEY, file_path TEXT, line_number INTEGER,
      end_line_number INTEGER, body TEXT);
  `);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?)").run(
    "repo",
    "https://github.com/focaldata/orchestra.git",
    NodePath.join(root, "conductor", "orchestra"),
  );
  const workspace = db.prepare(
    "INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
  );
  workspace.run(
    "ws",
    "repo",
    "yaounde",
    "ah/google-drive-connection-access",
    "ready",
    workspacePath,
    "2026-09-08T21:09:22.281Z",
    "2026-09-30T12:38:42.711Z",
  );
  workspace.run("gone", "repo", "lima", "ah/old", "archived", workspacePath, null, "2026-09-01");
  const session = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  session.run(
    "claude-tab",
    "ws",
    "Google Drive connection",
    "claude",
    claudeSessionId,
    "fable-5-1",
    0,
    "2026-09-08 20:47:05",
  );
  session.run(
    "grok-tab",
    "ws",
    "Untitled",
    "cursor",
    "cursor-chat",
    "grok-4.6",
    0,
    "2026-09-09 10:00:00",
  );
  session.run("empty-tab", "ws", "Untitled", "claude", null, "opus", 0, "2026-09-10 10:00:00");
  session.run("closed-tab", "ws", "Closed", "claude", null, "opus", 1, "2026-09-11 10:00:00");
  const message = db.prepare("INSERT INTO session_messages VALUES (?, ?, ?, ?, ?, ?, ?)");
  const at = (minute: number) => `2026-09-08T20:${String(minute).padStart(2, "0")}:00.000Z`;
  message.run(
    "m1",
    "claude-tab",
    "user",
    "Do you have Drive access? @⟦shot.png⟧(attachment:a1) @⟦pasted.txt⟧(attachment:a2)",
    at(47),
    at(47),
    null,
  );
  const attachmentsDir = NodePath.join(workspacePath, ".context", "attachments");
  NodeFS.mkdirSync(attachmentsDir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(attachmentsDir, "shot.png"), "png-bytes");
  const attachment = db.prepare("INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  attachment.run(
    "a1",
    "image",
    "shot.png",
    NodePath.join(attachmentsDir, "shot.png"),
    "claude-tab",
    "m1",
    0,
    null,
  );
  // Conductor deleted this one.
  attachment.run(
    "a2",
    "text",
    "pasted.txt",
    NodePath.join(attachmentsDir, "pasted.txt"),
    "claude-tab",
    "m1",
    0,
    null,
  );
  message.run(
    "m2",
    "claude-tab",
    "assistant",
    assistant([{ type: "text", text: "Yes." }]),
    at(48),
    null,
    null,
  );
  message.run("m3", "claude-tab", "user", "Queued, never sent", at(49), null, null);
  message.run("m4", "grok-tab", "user", "Add Grok 4.7", at(50), at(50), null);
  message.run("m5", "closed-tab", "user", "Hidden", at(51), at(51), null);
  db.close();
  return { root, projectRoot, workspacePath, databasePath, stateDir: NodePath.join(root, "t3") };
}

it("keeps prompts and top-level replies, merging replies split by tool calls", () => {
  const transcript = parseConductorTranscript([
    { id: "r1", role: "user", content: "Fix it", createdAt: "2026-09-08 20:00:00" },
    {
      id: "r2",
      role: "assistant",
      content: JSON.stringify({ type: "system", subtype: "init" }),
      createdAt: "2026-09-08T20:00:01Z",
    },
    {
      id: "r3",
      role: "assistant",
      content: assistant([{ type: "text", text: "Looking." }]),
      createdAt: "2026-09-08T20:00:02Z",
    },
    {
      id: "r4",
      role: "assistant",
      content: assistant([{ type: "tool_use", id: "t", name: "Bash", input: {} }]),
      createdAt: "2026-09-08T20:00:03Z",
    },
    {
      id: "r5",
      role: "assistant",
      content: JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } }),
      createdAt: "2026-09-08T20:00:04Z",
    },
    {
      id: "r6",
      role: "assistant",
      content: assistant([{ type: "text", text: "Subagent noise" }], { parent_tool_use_id: "t" }),
      createdAt: "2026-09-08T20:00:05Z",
    },
    {
      id: "r7",
      role: "assistant",
      content: assistant([
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Fixed." },
      ]),
      createdAt: "2026-09-08T20:00:06Z",
    },
    { id: "r8", role: "user", content: "Thanks", createdAt: "2026-09-08T20:01:00Z" },
  ]);
  expect(transcript).toEqual({
    model: "claude-fable-5-1",
    messages: [
      { role: "user", text: "Fix it", createdAt: "2026-09-08T20:00:00.000Z" },
      { role: "assistant", text: "Looking.\n\nFixed.", createdAt: "2026-09-08T20:00:02.000Z" },
      { role: "user", text: "Thanks", createdAt: "2026-09-08T20:01:00.000Z" },
    ],
  });
});

it("removes attachment mentions and inlines diff comments sent with a prompt", () => {
  const review = {
    id: "c",
    messageId: "review",
    type: "review",
    name: "ingestion.py +55-58",
    path: "cloud_functions/ingestion.py",
    commentFilePath: "cloud_functions/ingestion.py",
    commentStartLine: 55,
    commentEndLine: 58,
    commentBody: "Fix the typing here",
  };
  const image = {
    ...review,
    id: "i",
    messageId: "prompt",
    type: "image",
    name: "shot.png",
    path: "/ws/.context/attachments/shot.png",
    commentFilePath: null,
    commentStartLine: null,
    commentEndLine: null,
    commentBody: null,
  };
  const transcript = parseConductorTranscript(
    [
      {
        id: "prompt",
        role: "user",
        content: "Broken @⟦shot.png⟧(attachment:i)",
        createdAt: "2026-09-08T20:00:00Z",
      },
      { id: "review", role: "user", content: "", createdAt: "2026-09-08T20:01:00Z" },
    ],
    [image, review],
  );
  expect(transcript.messages).toEqual([
    {
      role: "user",
      text: "Broken",
      createdAt: "2026-09-08T20:00:00.000Z",
      files: [
        {
          attachmentId: "i",
          kind: "image",
          name: "shot.png",
          path: "/ws/.context/attachments/shot.png",
        },
      ],
    },
    {
      role: "user",
      text: "Review comment on `cloud_functions/ingestion.py` lines 55–58:\n\nFix the typing here",
      createdAt: "2026-09-08T20:01:00.000Z",
    },
  ]);
});

it.effect("imports a workspace's open tabs as one tab group in Conductor's worktree", () => {
  const fixture = makeFixture();
  const writes: Array<ReadonlyArray<OrchestrationV2DomainEvent>> = [];
  const adopted: Array<ReadonlyArray<ThreadId>> = [];
  const created = new Set<string>();
  const layer = ConductorImporter.layerWithDatabasePath(fixture.databasePath).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({ id: projectId, workspaceRoot: fixture.projectRoot } as never),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: (threadId) =>
            Effect.succeed(
              created.has(threadId)
                ? ({ id: threadId, deletedAt: null } as OrchestrationV2ThreadShell)
                : null,
            ),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          write: (input) =>
            Effect.sync(() => {
              writes.push(input.events);
              for (const event of input.events) created.add(event.threadId);
              return [];
            }),
        }),
        Layer.mock(ThreadTabs)({
          adopt: (threadIds) => Effect.sync(() => void adopted.push(threadIds)),
        }),
        IdAllocator.layer,
        ServerConfig.layerTest(fixture.root, fixture.stateDir).pipe(
          Layer.provide(NodeServices.layer),
        ),
        NodeServices.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const importer = yield* ConductorImporter.ConductorImporter;
    const listed = yield* importer.listWorkspaces({ projectId });
    expect(listed).toEqual({
      available: true,
      workspaces: [
        {
          workspaceId: "ws",
          title: "Google drive connection access",
          name: "yaounde",
          branch: "ah/google-drive-connection-access",
          path: fixture.workspacePath,
          updatedAt: "2026-09-30T12:38:42.711Z",
          tabs: [
            {
              sessionId: "claude-tab",
              title: "Google Drive connection",
              agent: "claude",
              messageCount: 1,
            },
            { sessionId: "grok-tab", title: "Untitled", agent: "cursor", messageCount: 1 },
          ],
          threadId: null,
        },
      ],
    });

    const result = yield* importer.importWorkspace({ projectId, workspaceId: "ws" });
    expect(result).toEqual({ threadIds: ["conductor:claude-tab", "conductor:grok-tab"] });
    expect(adopted).toEqual([["conductor:claude-tab", "conductor:grok-tab"]]);
    expect(writes.map((events) => events.map((event) => event.type))).toEqual([
      [
        "thread.created",
        "message.updated",
        "turn-item.updated",
        "message.updated",
        "turn-item.updated",
        "provider-thread.updated",
      ],
      ["thread.created", "message.updated", "turn-item.updated"],
    ]);

    const [claude, grok] = writes.map((events) => events[0]?.payload);
    expect(claude).toMatchObject({
      title: "Google Drive connection",
      branch: "ah/google-drive-connection-access",
      worktreePath: fixture.workspacePath,
      modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5-1" },
      historyOrigin: "v1_import",
      settledOverride: "active",
      settledAt: null,
    });
    expect(claude).not.toMatchObject({ pinnedAt: null });
    const prompt = writes[0]?.[1]?.payload;
    expect(prompt).toMatchObject({
      text: "Do you have Drive access?\n\n(Attachment not available: pasted.txt)",
      attachments: [{ type: "image", name: "shot.png", mimeType: "image/png", sizeBytes: 9 }],
    });
    const config = yield* ServerConfig.ServerConfig;
    const [copied] = (prompt as { attachments: ReadonlyArray<{ id: string }> }).attachments;
    expect(
      NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${copied!.id}.png`), "utf8"),
    ).toBe("png-bytes");
    expect(writes[0]?.at(-1)?.payload).toMatchObject({
      nativeThreadRef: { driver: "claudeAgent", nativeId: claudeSessionId, strength: "strong" },
      nativeMetadata: { importedNativeId: claudeSessionId },
    });
    // Conductor's Cursor sessions cannot be resumed, so the history is handed off instead.
    expect(grok).toMatchObject({
      title: "Google drive connection access",
      providerInstanceId: "cursor",
      activeProviderThreadId: null,
      pinnedAt: null,
    });

    expect(yield* importer.importWorkspace({ projectId, workspaceId: "ws" })).toEqual(result);
    expect(writes).toHaveLength(2);
    expect((yield* importer.listWorkspaces({ projectId })).workspaces[0]?.threadId).toBe(
      "conductor:claude-tab",
    );
  }).pipe(
    Effect.provide(layer),
    Effect.ensuring(
      Effect.sync(() => NodeFS.rmSync(fixture.root, { recursive: true, force: true })),
    ),
  );
});
