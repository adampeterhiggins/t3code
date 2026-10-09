import {
  type LinearAssignmentTrigger,
  LinearError,
  type LinearThreadLink,
  type OrchestrationV2ThreadProjection,
  type Project,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { ensureLinearAssignmentTriggerSchema } from "./assignmentTriggerSchema.ts";
import { LinearApi, type LinearAssignedIssue } from "./LinearApi.ts";
import * as LinearAssignmentTriggers from "./LinearAssignmentTriggers.ts";
import { LinearThreadLinks } from "./LinearThreadLinks.ts";

const projectId = ProjectId.make("project-1");

const rule = (overrides: Partial<LinearAssignmentTrigger> = {}): LinearAssignmentTrigger => ({
  id: "rule-1",
  projectId,
  teamId: null,
  labelName: null,
  prompt: null,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  ...overrides,
});

const assigned = (id: string, labelNames: ReadonlyArray<string> = []): LinearAssignedIssue => ({
  id,
  teamId: "team-eng",
  labelNames,
});

describe("planAssignmentTriggers", () => {
  it("records a new rule's already-assigned issues instead of starting them", () => {
    const plan = LinearAssignmentTriggers.planAssignmentTriggers({
      accountId: "me",
      issues: [assigned("a"), assigned("b")],
      rules: [rule()],
      baselinedRuleKeys: new Set(),
      recordedIssueIds: new Set(),
    });
    assert.deepEqual(plan.starts, []);
    assert.deepEqual(plan.baselineIssueIds, ["a", "b"]);
    assert.strictEqual(plan.baselineRuleKeys.length, 1);
  });

  it("starts unrecorded issues a baselined rule matches, by team and label", () => {
    const labelled = rule({ teamId: "team-eng", labelName: "Agent" });
    const plan = LinearAssignmentTriggers.planAssignmentTriggers({
      accountId: "me",
      issues: [assigned("a", ["agent"]), assigned("b"), assigned("c", ["agent"])],
      rules: [labelled],
      baselinedRuleKeys: new Set([
        LinearAssignmentTriggers.assignmentTriggerRuleKey(labelled, "me"),
      ]),
      recordedIssueIds: new Set(["c"]),
    });
    assert.deepEqual(
      plan.starts.map((start) => start.issueId),
      ["a"],
    );
    assert.deepEqual(plan.baselineIssueIds, []);
  });

  it("treats an edited filter or another account as a new rule", () => {
    const original = rule({ labelName: "agent" });
    const key = LinearAssignmentTriggers.assignmentTriggerRuleKey(original, "me");
    assert.notStrictEqual(
      key,
      LinearAssignmentTriggers.assignmentTriggerRuleKey({ ...original, labelName: null }, "me"),
    );
    assert.notStrictEqual(
      key,
      LinearAssignmentTriggers.assignmentTriggerRuleKey(original, "other"),
    );
    // Label case does not matter for matching, so it does not re-baseline either.
    assert.strictEqual(
      key,
      LinearAssignmentTriggers.assignmentTriggerRuleKey({ ...original, labelName: "Agent" }, "me"),
    );
  });
});

/** Mutable world the mocked services read, so a test can assign issues between polls. */
const world = {
  accountId: "me",
  issues: [] as Array<LinearAssignedIssue>,
  rules: [] as Array<LinearAssignmentTrigger>,
  failLaunches: false,
  launches: [] as Array<ThreadLaunch.ThreadLaunchInput>,
  links: [] as Array<string>,
};

const testLayer = Layer.mergeAll(
  Layer.mock(LinearApi)({
    listAssignedIssues: Effect.suspend(() =>
      Effect.succeed({ accountId: world.accountId, issues: [...world.issues] }),
    ),
    getIssue: ({ id }) =>
      Effect.succeed({
        id,
        identifier: `ENG-${id}`,
        title: `Issue ${id}`,
        url: `https://linear.app/acme/issue/ENG-${id}`,
        stateName: "Todo",
        stateType: "unstarted",
        stateColor: "#e2e2e2",
        priorityLabel: null,
        assigneeName: "Me",
        updatedAt: "2026-10-09T00:00:00.000Z",
        markdown: `# ENG-${id}`,
      }),
  }),
  Layer.mock(LinearThreadLinks)({
    link: ({ issueId }) =>
      Effect.sync(() => {
        world.links.push(issueId);
        return {} as LinearThreadLink;
      }),
  }),
  Layer.mock(ThreadLaunch.ThreadLaunchService)({
    launch: (input) =>
      Effect.suspend(() => {
        if (world.failLaunches) {
          return Effect.fail(
            new ThreadLaunch.ThreadLaunchError({
              commandId: input.commandId,
              projectId: input.projectId,
              operation: "dispatch-message",
              cause: null,
            }),
          );
        }
        world.launches.push(input);
        return Effect.succeed({
          threadId: ThreadId.make(`thread-${input.commandId}`),
          projection: {} as OrchestrationV2ThreadProjection,
          resumed: false,
        });
      }),
  }),
  Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeed(Option.some({ workspaceRoot: "/repo" } as Project)),
  }),
  Layer.mock(GitWorkflow.GitWorkflowService)({
    localStatus: () => Effect.succeed({ isRepo: true, refName: "main" } as VcsStatusLocalResult),
  }),
  ServerSettings.layerTest(),
).pipe(
  Layer.provideMerge(
    Layer.effectDiscard(
      Effect.gen(function* () {
        yield* runMigrations();
        yield* ensureThreadTabsSchema();
        yield* ensureLinearAssignmentTriggerSchema();
      }),
    ),
  ),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

const setRules = (rules: Array<LinearAssignmentTrigger>) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({ linearAssignmentTriggers: rules });
  });

it.layer(testLayer)("LinearAssignmentTriggers.poll", (it) => {
  it.effect("starts each newly assigned issue once, across retries and restarts", () =>
    Effect.gen(function* () {
      world.issues = [assigned("old")];
      yield* setRules([rule({ prompt: "Fix it." })]);
      const service = yield* LinearAssignmentTriggers.make;

      // Enabling records what is already assigned.
      yield* service.poll;
      assert.strictEqual(world.launches.length, 0);

      // A failed start stays pending for the next poll.
      world.issues = [assigned("new"), assigned("old")];
      world.failLaunches = true;
      yield* service.poll;
      assert.strictEqual(world.launches.length, 0);

      world.failLaunches = false;
      yield* service.poll;
      assert.strictEqual(world.launches.length, 1);
      const launch = world.launches[0]!;
      assert.strictEqual(launch.commandId, "linear-assignment:new");
      assert.strictEqual(launch.projectId, projectId);
      assert.deepEqual(launch.workspaceStrategy, {
        type: "worktree",
        baseRef: "main",
        startFromOrigin: true,
      });
      assert.isTrue(launch.initialMessage?.text.startsWith("Fix it.\n\n[ENG-new]"));
      assert.strictEqual(launch.initialMessage?.context?.records[0]?.kind, "linear-issue");
      assert.deepEqual(world.links, ["new"]);

      // A restarted server reads the same tables and starts nothing again.
      const restarted = yield* LinearAssignmentTriggers.make;
      yield* restarted.poll;
      assert.strictEqual(world.launches.length, 1);

      // Signing in as someone else records their assignments rather than starting them.
      world.accountId = "someone-else";
      world.issues = [assigned("theirs")];
      yield* restarted.poll;
      assert.strictEqual(world.launches.length, 1);

      // Turning every rule off and on again re-baselines instead of firing.
      yield* setRules([]);
      yield* restarted.poll;
      world.issues = [assigned("theirs"), assigned("while-off")];
      yield* setRules([rule()]);
      yield* restarted.poll;
      assert.strictEqual(world.launches.length, 1);

      world.issues = [assigned("later"), ...world.issues];
      yield* restarted.poll;
      assert.deepEqual(
        world.launches.map((input) => input.commandId),
        ["linear-assignment:new", "linear-assignment:later"],
      );
    }),
  );

  it.effect("does nothing while Linear is disconnected", () =>
    Effect.gen(function* () {
      yield* setRules([rule({ id: "rule-disconnected" })]);
      const service = yield* LinearAssignmentTriggers.make.pipe(
        Effect.provide(
          Layer.mock(LinearApi)({
            listAssignedIssues: Effect.fail(
              new LinearError({ reason: "not-connected", detail: "Linear is not connected." }),
            ),
          }),
        ),
      );
      const before = world.launches.length;
      yield* service.poll;
      assert.strictEqual(world.launches.length, before);
    }),
  );
});
