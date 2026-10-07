import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ClaudeProviderCapabilitiesV2 } from "./Adapters/ClaudeAdapterV2.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type {
  ProviderAdapterV2Event,
  ProviderAdapterV2Shape,
  ProviderAdapterV2TurnInput,
} from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { checkpointWorkspace } from "./testkit/ReplayFixtureWorkspace.ts";

const driver = ProviderDriverKind.make("claudeAgent");
const instanceId = ProviderInstanceId.make("claudeAgent");
const modelSelection = { instanceId, model: "test-model" };

// A worktree handoff re-points the thread from inside its running turn. The
// workspace change detaches the single-thread session, which closes the
// turn's event stream without a terminal event.
it.effect("a workspace change ends the running turn as interrupted, not a provider error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace("workspace-change-detach");
      const worktreePath = yield* checkpointWorkspace("workspace-change-detach-worktree");
      const started: ProviderAdapterV2TurnInput[] = [];
      const adapter: ProviderAdapterV2Shape = {
        instanceId,
        driver,
        getCapabilities: () => Effect.succeed(ClaudeProviderCapabilitiesV2),
        planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
        openSession: (input) =>
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
            const now = yield* DateTime.now;
            return {
              instanceId,
              driver,
              providerSessionId: input.providerSessionId,
              providerSession: {
                id: input.providerSessionId,
                driver,
                providerInstanceId: instanceId,
                status: "ready",
                cwd: input.runtimePolicy.cwd ?? cwd,
                model: modelSelection.model,
                capabilities: ClaudeProviderCapabilitiesV2,
                createdAt: now,
                updatedAt: now,
                lastError: null,
              },
              events: Stream.fromQueue(events),
              ensureThread: ({ threadId }) =>
                Effect.succeed({
                  id: ProviderThreadId.make(`provider-thread:claude:${threadId}`),
                  driver,
                  providerInstanceId: instanceId,
                  providerSessionId: input.providerSessionId,
                  appThreadId: threadId,
                  ownerNodeId: null,
                  nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
                  nativeConversationHeadRef: null,
                  status: "idle",
                  firstRunOrdinal: null,
                  lastRunOrdinal: null,
                  handoffIds: [],
                  forkedFrom: null,
                  createdAt: now,
                  updatedAt: now,
                }),
              resumeThread: ({ providerThread }) =>
                Effect.succeed({ ...providerThread, providerSessionId: input.providerSessionId }),
              startTurn: (turn) =>
                Effect.gen(function* () {
                  started.push(turn);
                  yield* Queue.offer(events, {
                    type: "provider_turn.updated",
                    driver,
                    providerTurn: {
                      id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                      providerThreadId: turn.providerThread.id,
                      nodeId: turn.rootNodeId,
                      runAttemptId: turn.attemptId,
                      nativeTurnRef: {
                        driver,
                        nativeId: `native:${turn.attemptId}`,
                        strength: "strong",
                      },
                      ordinal: turn.providerTurnOrdinal,
                      status: "running",
                      startedAt: now,
                      completedAt: null,
                    },
                  });
                }),
              steerTurn: () => Effect.die("unused"),
              interruptTurn: () => Effect.die("unused"),
              respondToRuntimeRequest: () => Effect.die("unused"),
              readThreadSnapshot: () => Effect.die("unused"),
              rollbackThread: () => Effect.die("unused"),
              forkThread: () => Effect.die("unused"),
            };
          }),
      };
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const sink = yield* EventSink.EventSinkV2;
        const threadId = ThreadId.make("thread:workspace-change-detach");
        const providerTurnRunning = () =>
          orchestrator.streamDomainEvents.pipe(
            Stream.filter(
              (event: OrchestrationV2DomainEvent) =>
                event.type === "provider-turn.updated" && event.payload.status === "running",
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          );
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create"),
          threadId,
          projectId: ProjectId.make("project:workspace-change-detach"),
          title: "Workspace change detach",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: cwd,
          createdBy: "user",
          creationSource: "web",
        });
        const firstRunning = yield* providerTurnRunning();
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("investigate"),
          threadId,
          messageId: MessageId.make("message:investigate"),
          text: "Investigate, then hand off to a worktree",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        yield* worker.drain();
        yield* Fiber.join(firstRunning);
        const first = started[0]!;
        const providerTurn = (yield* orchestrator.getThreadProjection(threadId)).providerTurns[0]!;
        // The handoff tool call is still in flight when the binding commits.
        const handoffCallId = TurnItemId.make("turn-item:handoff-call");
        const now = yield* DateTime.now;
        yield* sink.write({
          events: [
            {
              id: EventId.make("handoff-call"),
              type: "turn-item.updated",
              threadId,
              runId: first.runId,
              occurredAt: now,
              payload: {
                id: handoffCallId,
                threadId,
                runId: first.runId,
                nodeId: first.rootNodeId,
                providerThreadId: providerTurn.providerThreadId,
                providerTurnId: providerTurn.id,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 100,
                status: "running",
                title: null,
                startedAt: now,
                completedAt: null,
                updatedAt: now,
                type: "dynamic_tool",
                toolName: "mcp__t3-code__t3_worktree_handoff",
                input: {},
              },
            },
          ],
        });

        yield* orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("handoff"),
          threadId,
          branch: "feature/handoff",
          worktreePath,
          expectedWorktreePath: cwd,
        });
        const continuationRunning = yield* providerTurnRunning();
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("continuation"),
          threadId,
          messageId: MessageId.make("message:continuation"),
          text: "Continue in the worktree",
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          createdBy: "agent",
          creationSource: "mcp",
        });
        yield* worker.drain();
        yield* Fiber.join(continuationRunning);

        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(
          after.runs.map((run) => `${run.status}${run.queueHeld === true ? ":held" : ""}`),
          ["interrupted", "running"],
        );
        assert.isUndefined(after.turnItems.find((item) => item.type === "error"));
        assert.equal(
          after.turnItems.find((item) => item.id === handoffCallId)?.status,
          "interrupted",
        );
        assert.include(
          after.turnItems.flatMap((item) =>
            item.type === "system_notice" && item.runId === first.runId ? [item.message] : [],
          ),
          `Continuing in ${worktreePath}`,
        );
        assert.equal(started[1]?.runtimePolicy.cwd, worktreePath);
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            { name: "workspace-change-detach" },
            ProviderAdapterRegistry.layerSingle(adapter),
            { runEffectWorker: false },
          ),
        ),
      );
    }),
  ),
);
