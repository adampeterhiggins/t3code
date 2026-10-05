import { expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as AgentSessionImporter from "./AgentSessionImporter.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";
import * as ProjectService from "./ProjectService.ts";

const projectId = ProjectId.make("agent-session-import-project");
const providerInstanceId = ProviderInstanceId.make("codex");
const providerSessionId = "native-codex-thread";
const threadId = ThreadId.make(`import:${providerInstanceId}:${providerSessionId}`);

it.effect("imports messages once and preserves the provider native resume binding", () => {
  const writes: Array<ReadonlyArray<OrchestrationV2DomainEvent>> = [];
  const upserts: Array<unknown> = [];
  const recorded: Array<unknown> = [];
  let imported = false;
  const scanner = AgentSessionScanner.AgentSessionScanner.of({
    scan: Effect.die("unused"),
    recentThreads: () =>
      Stream.succeed({
        _tag: "Importable",
        source: {
          provider: "codex",
          providerInstanceId,
          providerSessionId,
          filePath: "/tmp/native-codex-thread.jsonl",
          size: 100,
          mtimeMs: 2,
          device: 3,
          inode: 4,
          birthtimeMs: 1,
        },
        thread: {
          source: "codex",
          providerInstanceId,
          providerSessionId,
          title: "Imported thread",
          model: "gpt-5.4",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:01:00.000Z",
          messages: [
            { role: "user", text: "Fix it", createdAt: "2026-09-01T10:00:00.000Z" },
            { role: "assistant", text: "Fixed", createdAt: "2026-09-01T10:01:00.000Z" },
          ],
          messageCount: 2,
        },
      }),
  });
  const testLayer = AgentSessionImporter.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(AgentSessionScanner.AgentSessionScanner, scanner),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(
              Option.some({ id: projectId, workspaceRoot: "/workspace/project" } as never),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: () =>
            imported
              ? Effect.succeed({
                  thread: { id: threadId, projectId, historyOrigin: "v1_import" },
                } as never)
              : Effect.fail(new Orchestrator.OrchestratorProjectionError({ threadId })),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          write: (input) =>
            Effect.sync(() => {
              writes.push(input.events);
              imported = true;
              return [];
            }),
        }),
        Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
          list: () => Effect.succeed([]),
          upsert: (input) => Effect.sync(() => void upserts.push(input)),
          recordImportedTranscript: (input) => Effect.sync(() => void recorded.push(input)),
        }),
        IdAllocator.layer,
        SqlitePersistenceMemory,
      ),
    ),
  );

  return Effect.gen(function* () {
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    expect(yield* importer.importRecentAgentThreads({ projectId })).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });
    expect(yield* importer.importRecentAgentThreads({ projectId })).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.map((event) => event.type)).toEqual([
      "thread.created",
      "message.updated",
      "turn-item.updated",
      "message.updated",
      "turn-item.updated",
      "provider-thread.updated",
    ]);
    const created = writes[0]?.find((event) => event.type === "thread.created");
    const providerThread = writes[0]?.find((event) => event.type === "provider-thread.updated");
    expect(created?.payload).toMatchObject({
      id: threadId,
      activeProviderThreadId: providerThread?.payload.id,
      historyOrigin: "v1_import",
    });
    expect(providerThread?.payload).toMatchObject({
      appThreadId: threadId,
      nativeThreadRef: {
        driver: "codex",
        nativeId: providerSessionId,
        strength: "strong",
      },
    });
    expect(
      writes[0]
        ?.filter((event) => event.type === "message.updated")
        .map((event) => event.payload.text),
    ).toEqual(["Fix it", "Fixed"]);
    expect(upserts).toEqual([
      expect.objectContaining({
        threadId,
        providerInstanceId,
        resumeCursor: { threadId: providerSessionId },
      }),
    ]);
    expect(recorded).toHaveLength(2);
  }).pipe(Effect.provide(testLayer));
});

const databaseLayer = SqlitePersistenceMemory;
const storesProvided = Layer.mergeAll(
  databaseLayer,
  EventStore.layer.pipe(Layer.provideMerge(databaseLayer)),
  ProjectionStore.layer.pipe(Layer.provideMerge(databaseLayer)),
);
const eventSinkProvided = EventSink.layer.pipe(Layer.provide(storesProvided));

function recentSession(
  providerSessionId: string,
  prompt: string,
): Extract<AgentSessionScanner.AgentSessionRecentThread, { _tag: "Importable" }> {
  return {
    _tag: "Importable",
    source: {
      provider: "codex",
      providerInstanceId,
      providerSessionId,
      filePath: `/tmp/rollout-${providerSessionId}.jsonl`,
      size: 100,
      mtimeMs: 2,
      device: 3,
      inode: 4,
      birthtimeMs: 1,
    },
    thread: {
      source: "codex",
      providerInstanceId,
      providerSessionId,
      title: prompt,
      model: "gpt-5.4",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:01:00.000Z",
      messages: [
        { role: "user", text: `\n${prompt}\nwith details`, createdAt: "2026-09-01T10:00:00.000Z" },
        { role: "assistant", text: "Done", createdAt: "2026-09-01T10:01:00.000Z" },
      ],
      messageCount: 12,
    },
  };
}

/** A thread T3 started itself, resuming `nativeId` through its active provider thread. */
function startedThreadEvents(input: {
  readonly threadId: ThreadId;
  readonly nativeId: string;
  readonly archived?: boolean;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const at = DateTime.makeUnsafe("2026-09-01T09:00:00.000Z");
  const providerThreadId = ProviderThreadId.make(`provider-thread:${input.threadId}`);
  const driver = ProviderDriverKind.make("codex");
  return [
    {
      id: EventId.make(`test:${input.threadId}:created`),
      type: "thread.created",
      threadId: input.threadId,
      providerInstanceId,
      occurredAt: at,
      payload: {
        createdBy: "user",
        creationSource: "web",
        id: input.threadId,
        projectId,
        title: "Started in T3",
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThreadId,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
        forkedFrom: null,
        createdAt: at,
        updatedAt: at,
        archivedAt: input.archived === true ? at : null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    },
    {
      id: EventId.make(`test:${input.threadId}:provider-thread`),
      type: "provider-thread.updated",
      threadId: input.threadId,
      driver,
      providerInstanceId,
      occurredAt: at,
      payload: {
        id: providerThreadId,
        driver,
        providerInstanceId,
        providerSessionId: null,
        appThreadId: input.threadId,
        ownerNodeId: null,
        nativeThreadRef: { driver, nativeId: input.nativeId, strength: "strong" },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        createdAt: at,
        updatedAt: at,
      },
    },
  ];
}

it.effect("imports one picked session and lists sessions with the threads holding them", () => {
  const sessions = [
    recentSession("session-imported", "Fix the deploy"),
    recentSession("session-started", "Started here"),
    recentSession("session-archived", "Archived thread"),
    recentSession("session-new", "Brand new"),
  ];
  const scanOptions: Array<AgentSessionScanner.AgentSessionRecentThreadsOptions | undefined> = [];
  const scanner = AgentSessionScanner.AgentSessionScanner.of({
    scan: Effect.die("unused"),
    recentThreads: (_workspaceRoot, _completedSources, options) => {
      scanOptions.push(options);
      const wanted = options?.session;
      return Stream.fromIterable(
        sessions.filter(
          (outcome) =>
            wanted === undefined || outcome.thread.providerSessionId === wanted.providerSessionId,
        ),
      );
    },
  });
  const testLayer = AgentSessionImporter.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(AgentSessionScanner.AgentSessionScanner, scanner),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(
              Option.some({ id: projectId, workspaceRoot: "/workspace/project" } as never),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: (threadId) =>
            Effect.fail(new Orchestrator.OrchestratorProjectionError({ threadId })),
        }),
        Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
          list: () => Effect.succeed([]),
          upsert: () => Effect.void,
          recordImportedTranscript: () => Effect.void,
        }),
        IdAllocator.layer,
        eventSinkProvided,
        storesProvided,
      ),
    ),
  );

  return Effect.gen(function* () {
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    const eventSink = yield* EventSink.EventSinkV2;
    const importedId = ThreadId.make(`import:${providerInstanceId}:session-imported`);
    const startedId = ThreadId.make("thread-started");

    expect(
      yield* importer.importRecentAgentThreads({
        projectId,
        session: { providerInstanceId, providerSessionId: "session-imported" },
      }),
    ).toEqual({ importedCount: 1, skippedCount: 0, threadIds: [importedId] });
    expect(scanOptions[0]).toEqual({
      session: { providerInstanceId, providerSessionId: "session-imported" },
      refresh: true,
    });

    yield* eventSink.write({
      events: [
        ...startedThreadEvents({ threadId: startedId, nativeId: "session-started" }),
        ...startedThreadEvents({
          threadId: ThreadId.make("thread-archived"),
          nativeId: "session-archived",
          archived: true,
        }),
      ],
    });

    const listed = yield* importer.listProjectAgentSessions({ projectId });
    expect(scanOptions[1]).toEqual({ refresh: true });
    expect(listed.truncated).toBe(false);
    expect(listed.sessions.map((session) => [session.providerSessionId, session.threadId])).toEqual(
      [
        ["session-imported", importedId],
        ["session-started", startedId],
        // Archived threads are not offered; importing makes a fresh thread.
        ["session-archived", null],
        ["session-new", null],
      ],
    );
    expect(listed.sessions[0]).toMatchObject({
      provider: "codex",
      title: "Fix the deploy",
      preview: "Fix the deploy",
      messageCount: 12,
    });
  }).pipe(Effect.provide(testLayer));
});

it.effect("caps the listing and reports truncation", () => {
  const sessions = Array.from({ length: 51 }, (_, index) =>
    recentSession(`session-${index}`, `Prompt ${index}`),
  );
  const testLayer = AgentSessionImporter.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          AgentSessionScanner.AgentSessionScanner,
          AgentSessionScanner.AgentSessionScanner.of({
            scan: Effect.die("unused"),
            recentThreads: () => Stream.fromIterable(sessions),
          }),
        ),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(
              Option.some({ id: projectId, workspaceRoot: "/workspace/project" } as never),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({}),
        Layer.mock(EventSink.EventSinkV2)({}),
        Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({}),
        IdAllocator.layer,
        SqlitePersistenceMemory,
      ),
    ),
  );

  return Effect.gen(function* () {
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    const listed = yield* importer.listProjectAgentSessions({ projectId });
    expect(listed.sessions).toHaveLength(50);
    expect(listed.truncated).toBe(true);
  }).pipe(Effect.provide(testLayer));
});
