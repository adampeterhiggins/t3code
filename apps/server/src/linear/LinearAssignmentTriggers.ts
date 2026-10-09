import {
  CommandId,
  type LinearAssignmentTrigger,
  MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { linearIssueContextRecord } from "@t3tools/shared/integrationContextRecords";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { LinearApi, type LinearAssignedIssue } from "./LinearApi.ts";
import { LinearThreadLinks } from "./LinearThreadLinks.ts";

const POLL_INTERVAL = "2 minutes";
const DEFAULT_PROMPT = "This Linear issue was just assigned to me. Work on it.";

class TriggerProjectMissing extends Data.TaggedError("TriggerProjectMissing")<{
  readonly projectId: string;
}> {}

export function matchesAssignmentTrigger(
  rule: Pick<LinearAssignmentTrigger, "teamId" | "labelName">,
  issue: LinearAssignedIssue,
): boolean {
  if (rule.teamId !== null && rule.teamId !== issue.teamId) return false;
  if (rule.labelName === null) return true;
  const wanted = rule.labelName.toLowerCase();
  return issue.labelNames.some((name) => name.toLowerCase() === wanted);
}

/**
 * What a rule's baseline is recorded under. Changing a rule's filters or the connected account
 * changes the key, so the issues already assigned at that point are recorded rather than started.
 */
export function assignmentTriggerRuleKey(
  rule: Pick<LinearAssignmentTrigger, "id" | "teamId" | "labelName">,
  accountId: string,
): string {
  return JSON.stringify([rule.id, accountId, rule.teamId, rule.labelName?.toLowerCase() ?? null]);
}

export interface AssignmentTriggerPlan {
  /** Rule keys seen for the first time; their already-assigned issues are recorded, not started. */
  readonly baselineRuleKeys: ReadonlyArray<string>;
  readonly baselineIssueIds: ReadonlyArray<string>;
  readonly starts: ReadonlyArray<{
    readonly issueId: string;
    readonly rule: LinearAssignmentTrigger;
  }>;
}

/**
 * Decides what one poll does. An issue already recorded is skipped. An unrecorded issue that a
 * rule from an earlier poll matches starts a thread with the first such rule. One that only a
 * new rule matches was already assigned when that rule was added, so it is recorded instead.
 * An issue no rule matches stays unrecorded, so it starts a thread once it gains the label.
 */
export function planAssignmentTriggers(input: {
  readonly accountId: string;
  readonly issues: ReadonlyArray<LinearAssignedIssue>;
  readonly rules: ReadonlyArray<LinearAssignmentTrigger>;
  readonly baselinedRuleKeys: ReadonlySet<string>;
  readonly recordedIssueIds: ReadonlySet<string>;
}): AssignmentTriggerPlan {
  const isKnown = (rule: LinearAssignmentTrigger) =>
    input.baselinedRuleKeys.has(assignmentTriggerRuleKey(rule, input.accountId));
  const known = input.rules.filter(isKnown);
  const added = input.rules.filter((rule) => !isKnown(rule));
  const baselineIssueIds: string[] = [];
  const starts: Array<{ issueId: string; rule: LinearAssignmentTrigger }> = [];
  for (const issue of input.issues) {
    if (input.recordedIssueIds.has(issue.id)) continue;
    const rule = known.find((candidate) => matchesAssignmentTrigger(candidate, issue));
    if (rule !== undefined) starts.push({ issueId: issue.id, rule });
    else if (added.some((candidate) => matchesAssignmentTrigger(candidate, issue))) {
      baselineIssueIds.push(issue.id);
    }
  }
  return {
    baselineRuleKeys: added.map((rule) => assignmentTriggerRuleKey(rule, input.accountId)),
    baselineIssueIds,
    starts,
  };
}

/**
 * Fork: polls Linear for issues newly assigned to the connected account and starts a thread for
 * each one a rule in `linearAssignmentTriggers` matches, the way starting a thread from an issue
 * does: a new worktree, the issue attached as context, and the thread linked to the issue.
 * Polling uses the read-only OAuth token, so it needs no webhook or public address.
 */
export class LinearAssignmentTriggers extends Context.Service<
  LinearAssignmentTriggers,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** One poll: records new rules' assigned issues and starts threads for new assignments. */
    readonly poll: Effect.Effect<void>;
  }
>()("t3/linear/LinearAssignmentTriggers") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* LinearApi;
  const links = yield* LinearThreadLinks;
  const launcher = yield* ThreadLaunch.ThreadLaunchService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitWorkflow.GitWorkflowService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const launchFor = Effect.fn("LinearAssignmentTriggers.launch")(function* (
    issueId: string,
    rule: LinearAssignmentTrigger,
  ) {
    const issue = yield* api.getIssue({ id: issueId });
    const project = yield* projects.getById(rule.projectId);
    if (Option.isNone(project)) {
      return yield* new TriggerProjectMissing({ projectId: rule.projectId });
    }
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      rule.projectId,
    ).settings;
    const status = yield* git.localStatus({ cwd: project.value.workspaceRoot });
    const record = linearIssueContextRecord(issue);
    // The command id makes a retry after a failed link or record return the same thread.
    const key = `linear-assignment:${issue.id}`;
    const launched = yield* launcher.launch({
      commandId: CommandId.make(key),
      projectId: rule.projectId,
      title: `${issue.identifier} ${issue.title}`.slice(0, 200),
      modelSelection: rule.modelSelection,
      runtimeMode: settings.defaultRuntimeMode,
      interactionMode: "default",
      workspaceStrategy: status.isRepo
        ? {
            type: "worktree",
            baseRef: status.refName ?? "HEAD",
            startFromOrigin: status.refName !== null && settings.newWorktreesStartFromOrigin,
          }
        : { type: "root" },
      initialMessage: {
        messageId: MessageId.make(key),
        text: `${rule.prompt ?? DEFAULT_PROMPT}\n\n${formatComposerContextReference(record)}`,
        attachments: [],
        context: { version: 1, records: [record] },
      },
      createdBy: "system",
      creationSource: "server",
    });
    yield* links.link({ threadId: launched.threadId, issueId: issue.id });
    return launched.threadId;
  });

  const record = (issueId: string, threadId: ThreadId | null) =>
    nowIso.pipe(
      Effect.flatMap(
        (at) => sql`
          INSERT OR IGNORE INTO fork_linear_assignment_issues (issue_id, thread_id, recorded_at)
          VALUES (${issueId}, ${threadId}, ${at})
        `,
      ),
    );

  const poll = Effect.gen(function* () {
    const rules = (yield* serverSettings.getSettings).linearAssignmentTriggers;
    if (rules.length === 0) {
      // Turning every rule off forgets the baselines, so turning one back on records again.
      yield* sql`DELETE FROM fork_linear_assignment_rules`;
      return;
    }

    const assigned = yield* api.listAssignedIssues.pipe(
      Effect.catchTags({
        LinearError: (error) =>
          (error.reason === "not-connected"
            ? Effect.void
            : Effect.logWarning("Linear assignment triggers could not read assigned issues", {
                reason: error.reason,
                detail: error.detail,
              })
          ).pipe(Effect.as(null)),
      }),
    );
    if (assigned === null) return;
    const { accountId, issues } = assigned;

    // A removed or edited rule's old key goes, so restoring it records its assigned issues again.
    const ruleKeys = rules.map((rule) => assignmentTriggerRuleKey(rule, accountId));
    yield* sql`DELETE FROM fork_linear_assignment_rules WHERE rule_key NOT IN ${sql.in(ruleKeys)}`;
    const baselined = yield* sql<{ readonly ruleKey: string }>`
      SELECT rule_key AS "ruleKey" FROM fork_linear_assignment_rules
    `;
    const recorded =
      issues.length === 0
        ? []
        : yield* sql<{ readonly issueId: string }>`
            SELECT issue_id AS "issueId" FROM fork_linear_assignment_issues
            WHERE issue_id IN ${sql.in(issues.map((issue) => issue.id))}
          `;
    const plan = planAssignmentTriggers({
      accountId,
      issues,
      rules,
      baselinedRuleKeys: new Set(baselined.map((row) => row.ruleKey)),
      recordedIssueIds: new Set(recorded.map((row) => row.issueId)),
    });

    // Issues are recorded before their rule, so a crash in between re-baselines, never starts.
    yield* Effect.forEach(plan.baselineIssueIds, (issueId) => record(issueId, null), {
      discard: true,
    });
    const at = yield* nowIso;
    yield* Effect.forEach(
      plan.baselineRuleKeys,
      (ruleKey) =>
        sql`
          INSERT OR IGNORE INTO fork_linear_assignment_rules (rule_key, account_id, baselined_at)
          VALUES (${ruleKey}, ${accountId}, ${at})
        `,
      { discard: true },
    );

    // A failed start stays unrecorded, so the next poll tries it again.
    yield* Effect.forEach(
      plan.starts,
      ({ issueId, rule }) =>
        launchFor(issueId, rule).pipe(
          Effect.flatMap((threadId) => record(issueId, threadId)),
          Effect.catchCause((cause) =>
            Effect.logWarning("Linear assignment trigger could not start a thread", {
              issueId,
              ruleId: rule.id,
              cause,
            }),
          ),
        ),
      { discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Linear assignment trigger poll failed", { cause }),
    ),
    Effect.withSpan("LinearAssignmentTriggers.poll"),
  );

  const start: LinearAssignmentTriggers["Service"]["start"] = () =>
    forkParked(poll.pipe(Effect.repeat(Schedule.spaced(POLL_INTERVAL)), Effect.asVoid));

  return LinearAssignmentTriggers.of({ start, poll });
});

export const layer = Layer.effect(LinearAssignmentTriggers, make);
