import {
  DEFAULT_SERVER_SETTINGS,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as ServerConfig from "../../../config.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ClientCommandDispatcher from "../../../orchestration/ClientCommandDispatcher.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import * as McpActor from "../../McpActor.ts";
import { OperateToolkitHandlersLive } from "./handlers.ts";
import { OperateToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const CALLER_ID = ThreadId.make("thread-caller");
const OTHER_ID = ThreadId.make("thread-other");
const NOW = "2026-08-01T00:00:00.000Z";

const project: OrchestrationProjectShell = {
  id: PROJECT_ID,
  title: "Project",
  workspaceRoot: "/workspace/project",
  defaultModelSelection: null,
  scripts: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const makeThread = (
  id: ThreadId,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id,
  projectId: PROJECT_ID,
  title: `Thread ${id}`,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const threadActor = (control: boolean): McpActor.McpActorValue => ({
  kind: "thread",
  threadId: CALLER_ID,
  capabilities: new Set(control ? ["pull-requests", "orchestration"] : ["pull-requests"]),
});

const makeHarness = Effect.fn("makeOperateHarness")(function* () {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const threads = yield* Ref.make<ReadonlyMap<ThreadId, OrchestrationThreadShell>>(
    new Map([
      [CALLER_ID, makeThread(CALLER_ID)],
      [OTHER_ID, makeThread(OTHER_ID)],
    ]),
  );
  const events = yield* PubSub.unbounded<OrchestrationEvent>();
  const details = yield* Ref.make<ReadonlyMap<ThreadId, OrchestrationThread>>(new Map());
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      ClientCommandDispatcher.ClientCommandDispatcher,
      ClientCommandDispatcher.ClientCommandDispatcher.of({
        forOrigin: () => ({
          dispatch: (command) =>
            Ref.update(commands, (recorded) => [...recorded, command]).pipe(
              Effect.as({ sequence: 1 }),
            ),
        }),
      }),
    ),
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) =>
        Ref.get(threads).pipe(Effect.map((all) => Option.fromNullishOr(all.get(threadId)))),
      getProjectShellById: (projectId) =>
        Effect.succeed(projectId === PROJECT_ID ? Option.some(project) : Option.none()),
      getShellSnapshot: () =>
        Ref.get(threads).pipe(
          Effect.map((all) => ({
            snapshotSequence: 1,
            projects: [project],
            threads: [...all.values()],
            updatedAt: NOW,
          })),
        ),
      getThreadDetailSnapshot: (threadId) =>
        Ref.get(details).pipe(
          Effect.map((all) => {
            const thread = all.get(threadId);
            return thread === undefined
              ? Option.none()
              : Option.some({ snapshotSequence: 1, thread });
          }),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () =>
        Effect.succeed({
          isRepo: true,
          hasPrimaryRemote: true,
          isDefaultRef: true,
          refName: "main",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
    }),
    WorkspacePaths.layer,
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-operate-handlers-" }),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  const toolkit = yield* OperateToolkit.pipe(
    Effect.provide(OperateToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof OperateToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    actor: McpActor.McpActorValue = threadActor(true),
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof OperateToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpActor.McpActor, actor),
    );
  const setThread = (thread: OrchestrationThreadShell) =>
    Ref.update(threads, (all) => new Map(all).set(thread.id, thread));
  const publish = (threadId: ThreadId) =>
    PubSub.publish(events, {
      type: "thread.session-set",
      aggregateKind: "thread",
      aggregateId: threadId,
      eventId: EventId.make(`event-${threadId}`),
      sequence: 2,
      occurredAt: NOW,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
    } as unknown as OrchestrationEvent);
  const setDetail = (thread: OrchestrationThread) =>
    Ref.update(details, (all) => new Map(all).set(thread.id, thread));
  return { commands, call, setThread, setDetail, publish };
});

describe("operate toolkit handlers", () => {
  it.effect("refuses a thread whose credential cannot drive threads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("create_thread", { message: "Hi" }, threadActor(false))
        .pipe(Effect.flip);
      expect(error.reason).toMatch(/Thread control is off/);
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("starts a thread in the caller's project, recorded as started by the caller", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("create_thread", {
        message: "Fix the flaky login test\nIt fails on CI.",
        workspace: "worktree",
      });
      expect(result).toMatchObject({
        projectId: PROJECT_ID,
        title: "Fix the flaky login test",
        status: "started",
      });
      const [command] = yield* Ref.get(harness.commands);
      expect(command).toMatchObject({
        type: "thread.turn.start",
        threadId: result.threadId,
        runtimeMode: "auto-accept-edits",
        message: { text: "Fix the flaky login test\nIt fails on CI." },
        bootstrap: {
          createThread: {
            projectId: PROJECT_ID,
            modelSelection: { instanceId: "codex", model: "gpt-5" },
            createdBy: { kind: "thread", threadId: CALLER_ID },
          },
          prepareWorktree: { projectCwd: "/workspace/project", baseBranch: "main" },
          runSetupScript: true,
        },
      });
    }),
  );

  it.effect("refuses a runtime mode above the caller's own", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("create_thread", { message: "Go", runtimeMode: "full-access" })
        .pipe(Effect.flip);
      expect(error.reason).toMatch(/cannot use full-access/);
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("records an external agent by its token label and needs a project", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const actor = { kind: "token", label: "Nightly triage" } as const;
      const missing = yield* harness
        .call("create_thread", { message: "Go" }, actor)
        .pipe(Effect.flip);
      expect(missing.reason).toMatch(/Pass projectId/);

      const result = yield* harness.call(
        "create_thread",
        { projectId: PROJECT_ID, model: { instanceId: "codex", model: "gpt-5" } },
        actor,
      );
      expect(result.status).toBe("idle");
      const [command] = yield* Ref.get(harness.commands);
      expect(command).toMatchObject({
        bootstrap: {
          deferTurn: true,
          createThread: { createdBy: { kind: "agent-access", label: "Nightly triage" } },
        },
      });
    }),
  );

  it.effect("messages another thread in its own modes, but never the caller", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.setThread(
        makeThread(OTHER_ID, { runtimeMode: "full-access", interactionMode: "plan" }),
      );
      yield* harness.call("send_message", { threadId: OTHER_ID, message: "Rebase on main" });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.turn.start",
          threadId: OTHER_ID,
          runtimeMode: "full-access",
          interactionMode: "plan",
          message: { text: "Rebase on main" },
        },
      ]);

      const self = yield* harness
        .call("send_message", { threadId: CALLER_ID, message: "Hello me" })
        .pipe(Effect.flip);
      expect(self.reason).toMatch(/your own thread/);
    }),
  );

  it.effect("waits until the thread stops working", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.setThread(
        makeThread(OTHER_ID, {
          session: {
            threadId: OTHER_ID,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
        }),
      );
      const waiting = yield* harness
        .call("wait_for_thread", { threadId: OTHER_ID, timeoutSeconds: 60 })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      // An unrelated thread's event does not end the wait.
      yield* harness.publish(CALLER_ID);
      yield* harness.setThread(makeThread(OTHER_ID, { hasPendingApprovals: true }));
      yield* harness.publish(OTHER_ID);
      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({ threadId: OTHER_ID, status: "needs-attention" });
    }),
  );

  it.effect("reports a working thread at once when asked not to wait", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.setThread(
        makeThread(OTHER_ID, {
          latestTurn: {
            turnId: "turn-1" as never,
            state: "running",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      );
      const result = yield* harness.call("wait_for_thread", {
        threadId: OTHER_ID,
        timeoutSeconds: 0,
      });
      expect(result.status).toBe("working");
    }),
  );

  it.effect("lists an open approval, which only the user's token may answer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const shell = makeThread(OTHER_ID, { hasPendingApprovals: true });
      yield* harness.setThread(shell);
      yield* harness.setDetail({
        ...shell,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        checkpoints: [],
        activities: [
          {
            id: EventId.make("activity-approval"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: {
              requestId: "request-1",
              requestKind: "command",
              detail: "rm -rf build",
              options: [
                { decision: "accept", label: "Run" },
                { decision: "decline", label: "Skip" },
              ],
            },
            turnId: null,
            createdAt: NOW,
          },
        ],
      });
      const status = yield* harness.call("wait_for_thread", {
        threadId: OTHER_ID,
        timeoutSeconds: 0,
      });
      expect(status.pendingRequests).toEqual([
        {
          requestId: "request-1",
          kind: "approval",
          summary: "Command approval requested",
          detail: "rm -rf build",
          decisions: ["accept", "decline"],
          questions: [],
        },
      ]);

      const refused = yield* harness
        .call("respond_to_request", {
          threadId: OTHER_ID,
          requestId: "request-1",
          decision: "accept",
        })
        .pipe(Effect.flip);
      expect(refused.reason).toMatch(/Only the user/);

      yield* harness.call(
        "respond_to_request",
        { threadId: OTHER_ID, requestId: "request-1", decision: "accept" },
        { kind: "token", label: "Supervisor" },
      );
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.approval.respond",
          threadId: OTHER_ID,
          requestId: "request-1",
          decision: "accept",
        },
      ]);
    }),
  );

  it.effect("changes another thread's state, and needs a time to snooze", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("set_thread_state", { threadId: OTHER_ID, action: "archive" });
      const missing = yield* harness
        .call("set_thread_state", { threadId: OTHER_ID, action: "snooze" })
        .pipe(Effect.flip);
      expect(missing.reason).toMatch(/snoozeUntil/);
      yield* harness.call("set_thread_state", {
        threadId: OTHER_ID,
        action: "snooze",
        snoozeUntil: "2026-08-02T09:00:00.000Z",
      });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "thread.archive", threadId: OTHER_ID },
        { type: "thread.snooze", threadId: OTHER_ID, snoozedUntil: "2026-08-02T09:00:00.000Z" },
      ]);
    }),
  );

  it.effect("updates another thread, but not past the caller's runtime mode", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const refused = yield* harness
        .call("update_thread", { threadId: OTHER_ID, runtimeMode: "full-access" })
        .pipe(Effect.flip);
      expect(refused.reason).toMatch(/cannot use full-access/);
      yield* harness.call("update_thread", {
        threadId: OTHER_ID,
        title: "Login fix",
        interactionMode: "plan",
      });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "thread.meta.update", threadId: OTHER_ID, title: "Login fix" },
        { type: "thread.interaction-mode.set", threadId: OTHER_ID, interactionMode: "plan" },
      ]);
    }),
  );

  it.effect("adds an existing folder as a project, named after it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("create_project", { workspaceRoot: process.cwd() });
      const folder = process.cwd().split("/").at(-1);
      expect(result.title).toBe(folder);
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "project.create", projectId: result.projectId, title: folder },
      ]);

      const missing = yield* harness
        .call("create_project", { workspaceRoot: `${process.cwd()}/does-not-exist-operate-test` })
        .pipe(Effect.flip);
      expect(missing._tag).toBe("OperateToolError");
    }),
  );
});
