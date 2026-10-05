import {
  legacyThreadPullRequestKey,
  threadPullRequestKeysEqual,
} from "@t3tools/shared/threadPullRequests";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Fragment } from "effect/unstable/sql/Statement";

import type {
  ActivityEntry,
  FileChange,
  MessageEntry,
  PlanEntry,
  ProjectSummary,
  PullRequestBrief,
  PullRequestEntry,
  SubagentTranscript,
  SubagentTranscriptEntry,
  ThreadStartedBy,
  ThreadSummary,
  TimelineEntry,
  TimelineKind,
  TurnSummary,
} from "./tools.ts";

/**
 * SQL behind the query toolkit. Everything reads the orchestration V2
 * projections the app renders from (plus `projection_projects`, which is still
 * the live project store), so what an agent sees matches what the user saw.
 * The V1 `projection_thread*` and `projection_turns` tables stopped updating at
 * the V2 cutover and are never read here.
 *
 * Mapping from the V1 shapes the tools kept: a turn is a V2 run (`turnId` is
 * the run id), an activity is a turn item other than a message or reasoning,
 * and a turn's `turnCount` is its checkpoint's `app_run_ordinal`, which is what
 * CheckpointDiffQuery diffs by. Deleted threads and projects never appear, and
 * subagent threads are left out of unscoped lists the way the sidebar hides
 * them. Times are ISO UTC strings, which compare correctly as text.
 */

export type Order = "asc" | "desc";
export type CursorKey = ReadonlyArray<string | number>;

export interface Window {
  readonly since: string;
  readonly until: string;
}

/** Bounds that match every stored timestamp. */
export const OPEN_WINDOW: Window = {
  since: "0000-01-01T00:00:00.000Z",
  until: "9999-12-31T23:59:59.999Z",
};

export interface PageRequest {
  readonly order: Order;
  readonly limit: number;
  readonly after: CursorKey | null;
}

export interface Page<A> {
  readonly items: ReadonlyArray<A>;
  readonly nextKey: CursorKey | null;
}

const MAX_CHANGED_FILES = 100;
const MAX_THREAD_PULL_REQUESTS = 10;
const TIMELINE_PROMPT_CHARS = 280;
const TIMELINE_SUMMARY_CHARS = 200;
const DETAIL_CHARS = 300;
const TRANSCRIPT_ENTRIES = 200;
const TRANSCRIPT_TEXT_CHARS = 2_000;

/** Runtime request kinds the user approves; `user_input` is a question. */
const APPROVAL_KINDS = ["command", "file-read", "file-change", "mcp-elicitation", "permission"];
/** Turn items that are conversation, not work; list_messages covers them. */
const MESSAGE_ITEM_TYPES = ["user_message", "assistant_message", "reasoning"];
const TOOL_ITEM_TYPES = [
  "command_execution",
  "file_change",
  "dynamic_tool",
  "file_search",
  "web_search",
  "subagent",
];
const NOTABLE_ITEM_TYPES = [
  ...TOOL_ITEM_TYPES,
  "todo_list",
  "proposed_plan",
  "approval_request",
  "user_input_request",
  "notification",
];
const ACTIVE_RUN_STATUSES = ["preparing", "starting", "running", "waiting"];

const ACTIVITY_LABELS: Record<string, string> = {
  command_execution: "Command",
  file_change: "File change",
  dynamic_tool: "Tool call",
  file_search: "File search",
  web_search: "Web search",
  subagent: "Subagent",
  error: "Error",
  approval_request: "Approval requested",
  user_input_request: "Question",
  todo_list: "Task list updated",
  proposed_plan: "Plan proposed",
  notification: "Notification",
  checkpoint: "Checkpoint",
  compaction: "Context compacted",
  handoff: "Provider handoff",
  fork: "Forked",
  thread_created: "Thread created",
  system_notice: "Notice",
  run_interrupt_request: "Interrupt requested",
  run_interrupt_result: "Interrupted",
};

/** Escapes LIKE wildcards; queries pass `ESCAPE '!'`. */
const likePattern = (text: string) => `%${text.replace(/[!%_]/g, (char) => `!${char}`)}%`;

const cut = (text: string | null, max: number) =>
  text === null
    ? { text: null, truncated: false }
    : text.length > max
      ? { text: `${text.slice(0, max)}…`, truncated: true }
      : { text, truncated: false };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === "string" ? (value[key] as string) : null;
const intField = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === "number" ? Math.trunc(value[key] as number) : null;

const parseFiles = (json: string | null): ReadonlyArray<FileChange> => {
  const parsed = parseJson(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): ReadonlyArray<FileChange> => {
    if (!isRecord(entry) || typeof entry.path !== "string") return [];
    return [
      {
        path: entry.path,
        kind: stringField(entry, "kind") ?? "modified",
        additions: intField(entry, "additions") ?? 0,
        deletions: intField(entry, "deletions") ?? 0,
      },
    ];
  });
};

/** Sums file changes across turns, oldest first, so the latest kind wins. */
const mergeFiles = (turns: ReadonlyArray<ReadonlyArray<FileChange>>): ReadonlyArray<FileChange> => {
  const byPath = new Map<string, FileChange>();
  for (const files of turns) {
    for (const file of files) {
      const previous = byPath.get(file.path);
      byPath.set(file.path, {
        ...file,
        additions: (previous?.additions ?? 0) + file.additions,
        deletions: (previous?.deletions ?? 0) + file.deletions,
      });
    }
  }
  return [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
};

const fileTotals = (files: ReadonlyArray<FileChange>) => ({
  additions: files.reduce((total, file) => total + file.additions, 0),
  deletions: files.reduce((total, file) => total + file.deletions, 0),
});

const planTitle = (markdown: string) => {
  const line = markdown
    .split("\n")
    .map((candidate) => candidate.replace(/^#+\s*/, "").trim())
    .find((candidate) => candidate.length > 0);
  return cut(line ?? "Untitled plan", 120).text ?? "Untitled plan";
};

const startedByOf = (json: string | null): ThreadStartedBy | null => {
  const parsed = parseJson(json);
  if (!isRecord(parsed)) return null;
  const threadId = stringField(parsed, "threadId");
  if (parsed.kind === "thread" && threadId !== null) return { kind: "thread", threadId };
  const label = stringField(parsed, "label");
  if (parsed.kind === "agent-access" && label !== null) return { kind: "agent-access", label };
  return null;
};

const activitySummary = (row: { readonly kind: string; readonly title: string | null }) =>
  row.title ?? ACTIVITY_LABELS[row.kind] ?? row.kind;

interface PullRequestRow {
  readonly host: string | null;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly source: string;
  readonly linkedAt: string;
  readonly snapshotJson: string | null;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly projectId: string;
}

const pullRequestOf = (row: PullRequestRow) => {
  const parsed = parseJson(row.snapshotJson);
  const snapshot = isRecord(parsed) ? parsed : {};
  return {
    brief: {
      // Links written before `pullRequests` carry no host; recover it the way the app does.
      host: row.host ?? legacyThreadPullRequestKey(row).host,
      repository: row.repository,
      number: row.number,
      url: row.url,
      title: stringField(snapshot, "title"),
      state: stringField(snapshot, "state"),
      isDraft: typeof snapshot.isDraft === "boolean" ? snapshot.isDraft : null,
    } satisfies PullRequestBrief,
    snapshot,
  };
};

const pullRequestEntryOf = (row: PullRequestRow): PullRequestEntry => {
  const { brief, snapshot } = pullRequestOf(row);
  return {
    ...brief,
    headBranch: stringField(snapshot, "headBranch"),
    baseBranch: stringField(snapshot, "baseBranch"),
    mergedAt: stringField(snapshot, "mergedAt"),
    closedAt: stringField(snapshot, "closedAt"),
    additions: intField(snapshot, "additions"),
    deletions: intField(snapshot, "deletions"),
    changedFiles: intField(snapshot, "changedFiles"),
    reviewDecision: stringField(snapshot, "reviewDecision"),
    checksState: stringField(snapshot, "checksState"),
    syncedAt: stringField(snapshot, "syncedAt"),
    linkedAt: row.linkedAt,
    linkSource: row.source,
    threadId: row.threadId,
    threadTitle: row.threadTitle,
    projectId: row.projectId,
  };
};

interface ThreadRow {
  readonly threadId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly archivedAt: string | null;
  readonly settledAt: string | null;
  readonly settledOverride: string | null;
  readonly pinnedAt: string | null;
  readonly snoozedUntil: string | null;
  readonly sessionStatus: string;
  readonly turnCount: number;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly hasActionableProposedPlan: number;
  readonly tabGroupId: string | null;
  readonly startedByJson: string | null;
  readonly historyOrigin: string | null;
  readonly windowFirstAt?: string | null;
  readonly windowLastAt?: string | null;
  readonly sortAt: string;
}

export interface ThreadFilter {
  readonly threadId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly window?: Window | undefined;
  readonly archived?: "exclude" | "only" | "include" | undefined;
  readonly needsAttention?: boolean | undefined;
  readonly hasPullRequest?: boolean | undefined;
  readonly provider?: string | undefined;
  readonly branch?: string | undefined;
  readonly titleContains?: string | undefined;
}

interface Scope {
  readonly threadId?: string | undefined;
  readonly projectId?: string | undefined;
}

export const makeQueryStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const direction = (order: Order) => (order === "asc" ? sql`ASC` : sql`DESC`);
  /** Keyset condition for rows after `key` in `order`; columns must match the ORDER BY. */
  const after = (columns: Fragment, page: PageRequest): Fragment =>
    page.after === null
      ? sql`1 = 1`
      : sql`(${columns}) ${page.order === "asc" ? sql`>` : sql`<`} ${sql.in(page.after)}`;

  const pageOf = <Row, A>(
    rows: ReadonlyArray<Row>,
    page: PageRequest,
    keyOf: (row: Row) => CursorKey,
    map: (row: Row) => A,
  ): Page<A> => {
    const kept = rows.slice(0, page.limit);
    const last = kept.at(-1);
    return {
      items: kept.map(map),
      nextKey: rows.length > page.limit && last !== undefined ? keyOf(last) : null,
    };
  };

  const idsIn = (column: string, ids: ReadonlyArray<string>) =>
    ids.length === 0 ? sql`1 = 0` : sql.in(column, ids);

  const liveThreads = sql`t.deleted_at IS NULL AND p.deleted_at IS NULL`;
  const notSubagent = sql`json_extract(t.payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'`;
  /** Threads a query covers: the named one, or every listed one in scope. */
  const scopeConditions = (scope: Scope): ReadonlyArray<Fragment> => [
    liveThreads,
    scope.threadId === undefined ? notSubagent : sql`t.thread_id = ${scope.threadId}`,
    ...(scope.projectId === undefined ? [] : [sql`t.project_id = ${scope.projectId}`]),
  ];
  const threadsFrom = sql`
    FROM orchestration_v2_projection_threads AS t
    JOIN projection_projects AS p ON p.project_id = t.project_id
  `;

  const lastActivitySql = sql`MAX(
    COALESCE(
      (SELECT MAX(um.created_at) FROM orchestration_v2_projection_messages AS um
        WHERE um.thread_id = t.thread_id AND um.role = 'user'),
      t.created_at
    ),
    COALESCE(
      (SELECT MAX(COALESCE(ru.completed_at, ru.requested_at)) FROM orchestration_v2_projection_runs AS ru
        WHERE ru.thread_id = t.thread_id),
      t.created_at
    )
  )`;

  /** Threads with a prompt, a turn request, or a turn finish inside the window. */
  const activitySql = (window: Window) => sql`
    SELECT thread_id, created_at AS at FROM orchestration_v2_projection_messages
      WHERE role = 'user' AND created_at >= ${window.since} AND created_at < ${window.until}
    UNION ALL
    SELECT thread_id, requested_at FROM orchestration_v2_projection_runs
      WHERE requested_at >= ${window.since} AND requested_at < ${window.until}
    UNION ALL
    SELECT thread_id, completed_at FROM orchestration_v2_projection_runs
      WHERE completed_at >= ${window.since} AND completed_at < ${window.until}
  `;

  /** A run's own checkpoint (baselines have no run); join as `cp`. */
  const runCheckpointJoin = sql`
    LEFT JOIN orchestration_v2_projection_checkpoints AS cp ON cp.checkpoint_id = (
      SELECT c.checkpoint_id FROM orchestration_v2_projection_checkpoints AS c
      WHERE c.thread_id = r.thread_id AND c.run_id = r.run_id AND c.app_run_ordinal IS NOT NULL
      ORDER BY c.captured_at DESC, c.checkpoint_id DESC LIMIT 1
    )
  `;

  const threadSelect = sql`
    SELECT
      t.thread_id AS "threadId",
      t.project_id AS "projectId",
      p.title AS "projectTitle",
      t.title,
      json_extract(t.payload_json, '$.branch') AS branch,
      json_extract(t.payload_json, '$.worktreePath') AS "worktreePath",
      t.provider_instance_id AS provider,
      json_extract(t.payload_json, '$.modelSelection.model') AS model,
      t.runtime_mode AS "runtimeMode",
      t.interaction_mode AS "interactionMode",
      t.created_at AS "createdAt",
      ${lastActivitySql} AS "lastActivityAt",
      t.archived_at AS "archivedAt",
      json_extract(t.payload_json, '$.settledAt') AS "settledAt",
      json_extract(t.payload_json, '$.settledOverride') AS "settledOverride",
      json_extract(t.payload_json, '$.pinnedAt') AS "pinnedAt",
      json_extract(t.payload_json, '$.snoozedUntil') AS "snoozedUntil",
      COALESCE((
        SELECT ru.status FROM orchestration_v2_projection_runs AS ru
        WHERE ru.thread_id = t.thread_id
          AND NOT (ru.status = 'queued' AND json_extract(ru.payload_json, '$.queueHeld') IS 1)
        ORDER BY ru.ordinal DESC LIMIT 1
      ), 'idle') AS "sessionStatus",
      (SELECT COUNT(*) FROM orchestration_v2_projection_runs AS ru
        WHERE ru.thread_id = t.thread_id AND ru.status <> 'rolled_back') AS "turnCount",
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests AS rq
        WHERE rq.thread_id = t.thread_id AND rq.status = 'pending'
          AND ${sql.in("rq.kind", APPROVAL_KINDS)}) AS "pendingApprovalCount",
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests AS rq
        WHERE rq.thread_id = t.thread_id AND rq.status = 'pending'
          AND rq.kind = 'user_input') AS "pendingUserInputCount",
      EXISTS (
        SELECT 1 FROM orchestration_v2_projection_plans AS pl
        WHERE pl.thread_id = t.thread_id AND pl.kind = 'proposed_plan' AND pl.status = 'active'
      ) AS "hasActionableProposedPlan",
      tabs.group_id AS "tabGroupId",
      json_extract(t.payload_json, '$.startedBy') AS "startedByJson",
      json_extract(t.payload_json, '$.historyOrigin') AS "historyOrigin"
    ${threadsFrom}
    LEFT JOIN fork_thread_tabs AS tabs ON tabs.thread_id = t.thread_id
  `;

  const hasPullRequestSql = sql`(
    EXISTS (
      SELECT 1 FROM json_each(t.payload_json, '$.pullRequests') AS link
      WHERE json_extract(link.value, '$.source') IS NOT 'stack-dismissed'
    )
    OR (
      json_type(t.payload_json, '$.pullRequests') IS NULL
      AND json_type(t.payload_json, '$.linkedPullRequest') = 'object'
    )
  )`;

  const threadConditions = (filter: ThreadFilter): Fragment =>
    sql.and([
      ...scopeConditions(filter),
      ...(filter.archived === "only"
        ? [sql`t.archived_at IS NOT NULL`]
        : filter.archived === "include"
          ? []
          : [sql`t.archived_at IS NULL`]),
      ...(filter.hasPullRequest === undefined
        ? []
        : [filter.hasPullRequest ? hasPullRequestSql : sql`NOT ${hasPullRequestSql}`]),
      ...(filter.branch === undefined
        ? []
        : [sql`json_extract(t.payload_json, '$.branch') = ${filter.branch}`]),
      ...(filter.titleContains === undefined
        ? []
        : [sql`t.title LIKE ${likePattern(filter.titleContains)} ESCAPE '!'`]),
    ]);

  /**
   * Live pull request links, one row per thread and pull request. Threads
   * whose payload predates `pullRequests` carry a single `linkedPullRequest`.
   */
  const pullRequestRows = (conditions: ReadonlyArray<Fragment>) => sql`
    SELECT json_extract(link.value, '$.host') AS host,
      json_extract(link.value, '$.repository') AS repository,
      json_extract(link.value, '$.number') AS number,
      json_extract(link.value, '$.url') AS url,
      json_extract(link.value, '$.source') AS source,
      json_extract(link.value, '$.linkedAt') AS "linkedAt",
      json_extract(link.value, '$.snapshot') AS "snapshotJson",
      t.thread_id AS "threadId", t.title AS "threadTitle", t.project_id AS "projectId"
    ${threadsFrom}
    JOIN json_each(t.payload_json, '$.pullRequests') AS link
    WHERE ${sql.and([...conditions, sql`json_extract(link.value, '$.source') IS NOT 'stack-dismissed'`])}
    UNION ALL
    SELECT NULL, json_extract(t.payload_json, '$.linkedPullRequest.repository'),
      json_extract(t.payload_json, '$.linkedPullRequest.number'),
      json_extract(t.payload_json, '$.linkedPullRequest.url'),
      'manual', '1970-01-01T00:00:00.000Z', NULL,
      t.thread_id, t.title, t.project_id
    ${threadsFrom}
    WHERE ${sql.and([
      ...conditions,
      sql`json_type(t.payload_json, '$.pullRequests') IS NULL`,
      sql`json_type(t.payload_json, '$.linkedPullRequest') = 'object'`,
    ])}
  `;

  const pullRequestBriefs = Effect.fn("QueryStore.pullRequestBriefs")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const rows = yield* sql<PullRequestRow>`
      SELECT * FROM (${pullRequestRows([liveThreads, idsIn("t.thread_id", threadIds)])})
      ORDER BY "linkedAt" DESC, url DESC
    `;
    const byThread = new Map<string, Array<PullRequestBrief>>();
    for (const row of rows) {
      byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), pullRequestOf(row).brief]);
    }
    return byThread;
  });

  const windowStats = Effect.fn("QueryStore.windowStats")(function* (
    threadIds: ReadonlyArray<string>,
    window: Window,
  ) {
    const prompts = yield* sql<{ readonly threadId: string; readonly count: number }>`
      SELECT thread_id AS "threadId", COUNT(*) AS count FROM orchestration_v2_projection_messages
      WHERE ${idsIn("thread_id", threadIds)} AND role = 'user'
        AND created_at >= ${window.since} AND created_at < ${window.until}
      GROUP BY thread_id
    `;
    const turns = yield* sql<{ readonly threadId: string; readonly filesJson: string | null }>`
      SELECT r.thread_id AS "threadId", json_extract(cp.payload_json, '$.files') AS "filesJson"
      FROM orchestration_v2_projection_runs AS r
      ${runCheckpointJoin}
      WHERE ${idsIn("r.thread_id", threadIds)}
        AND r.completed_at >= ${window.since} AND r.completed_at < ${window.until}
      ORDER BY r.completed_at ASC
    `;
    const promptCounts = new Map(prompts.map((row) => [row.threadId, row.count]));
    const turnFiles = new Map<string, Array<ReadonlyArray<FileChange>>>();
    for (const row of turns) {
      turnFiles.set(row.threadId, [
        ...(turnFiles.get(row.threadId) ?? []),
        parseFiles(row.filesJson),
      ]);
    }
    return (threadId: string) => {
      const files = mergeFiles(turnFiles.get(threadId) ?? []);
      return {
        prompts: promptCounts.get(threadId) ?? 0,
        turnsCompleted: turnFiles.get(threadId)?.length ?? 0,
        filesChanged: files.length,
        ...fileTotals(files),
      };
    };
  });

  const listThreads = Effect.fn("QueryStore.listThreads")(function* (
    filter: ThreadFilter,
    page: PageRequest,
  ) {
    const window = filter.window;
    const rows = yield* sql<ThreadRow>`
      WITH base AS (${threadSelect} WHERE ${threadConditions(filter)})
      ${
        window === undefined
          ? sql`SELECT base.*, base."lastActivityAt" AS "sortAt" FROM base`
          : sql`, activity AS (${activitySql(window)}),
            windowed AS (
              SELECT thread_id, MIN(at) AS first_at, MAX(at) AS last_at FROM activity GROUP BY thread_id
            )
            SELECT base.*, windowed.first_at AS "windowFirstAt", windowed.last_at AS "windowLastAt",
              windowed.last_at AS "sortAt"
            FROM base JOIN windowed ON windowed.thread_id = base."threadId"`
      }
      WHERE ${sql.and([
        ...(filter.needsAttention === undefined
          ? []
          : [
              filter.needsAttention
                ? sql`(base."pendingApprovalCount" > 0 OR base."pendingUserInputCount" > 0 OR base."hasActionableProposedPlan" = 1)`
                : sql`(base."pendingApprovalCount" = 0 AND base."pendingUserInputCount" = 0 AND base."hasActionableProposedPlan" = 0)`,
            ]),
        ...(filter.provider === undefined
          ? []
          : [
              sql`(base.provider = ${filter.provider} OR EXISTS (
                SELECT 1 FROM orchestration_v2_projection_provider_session_bindings AS b
                JOIN orchestration_v2_projection_provider_sessions AS s
                  ON s.provider_session_id = b.provider_session_id
                WHERE b.thread_id = base."threadId" AND s.driver = ${filter.provider}
              ))`,
            ]),
        after(sql`"sortAt", base."threadId"`, page),
      ])}
      ORDER BY "sortAt" ${direction(page.order)}, base."threadId" ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    const threadIds = rows.slice(0, page.limit).map((row) => row.threadId);
    const pullRequests = yield* pullRequestBriefs(threadIds);
    const stats = window === undefined ? null : yield* windowStats(threadIds, window);
    return pageOf(
      rows,
      page,
      (row) => [row.sortAt, row.threadId],
      (row): ThreadSummary => {
        const startedBy = startedByOf(row.startedByJson);
        return {
          threadId: row.threadId,
          projectId: row.projectId,
          projectTitle: row.projectTitle,
          title: row.title,
          branch: row.branch,
          worktreePath: row.worktreePath,
          provider: row.provider,
          model: row.model,
          runtimeMode: row.runtimeMode,
          interactionMode: row.interactionMode,
          createdAt: row.createdAt,
          lastActivityAt: row.lastActivityAt,
          archivedAt: row.archivedAt,
          settledAt: row.settledAt,
          settledOverride: row.settledOverride,
          pinnedAt: row.pinnedAt,
          snoozedUntil: row.snoozedUntil,
          sessionStatus: row.sessionStatus,
          turnCount: row.turnCount,
          pendingApprovalCount: row.pendingApprovalCount,
          pendingUserInputCount: row.pendingUserInputCount,
          hasActionableProposedPlan: row.hasActionableProposedPlan === 1,
          tabGroupId: row.tabGroupId,
          startedByThreadId: startedBy?.kind === "thread" ? startedBy.threadId : null,
          startedBy,
          importedFromV1: row.historyOrigin === "v1_import",
          pullRequests: (pullRequests.get(row.threadId) ?? []).slice(0, MAX_THREAD_PULL_REQUESTS),
          pullRequestCount: pullRequests.get(row.threadId)?.length ?? 0,
          ...(stats === null || !row.windowFirstAt || !row.windowLastAt
            ? {}
            : {
                window: {
                  firstActivityAt: row.windowFirstAt,
                  lastActivityAt: row.windowLastAt,
                  ...stats(row.threadId),
                },
              }),
        };
      },
    );
  });

  /** Files changed by completed turns with a ready checkpoint, as CheckpointDiffQuery diffs them. */
  const filesBetween = Effect.fn("QueryStore.filesBetween")(function* (input: {
    readonly threadId: string;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  }) {
    const rows = yield* sql<{ readonly filesJson: string | null }>`
      SELECT json_extract(c.payload_json, '$.files') AS "filesJson"
      FROM orchestration_v2_projection_checkpoints AS c
      JOIN orchestration_v2_projection_runs AS r ON r.run_id = c.run_id
      WHERE c.thread_id = ${input.threadId} AND c.status = 'ready' AND r.status = 'completed'
        AND c.app_run_ordinal > ${input.fromTurnCount}
        AND c.app_run_ordinal <= ${input.toTurnCount}
      ORDER BY c.app_run_ordinal ASC, c.captured_at ASC
    `;
    return mergeFiles(rows.map((row) => parseFiles(row.filesJson)));
  });

  const toneSql = sql`CASE
    WHEN i.type = 'error' THEN 'error'
    WHEN i.type IN ('approval_request', 'user_input_request') THEN 'approval'
    WHEN ${sql.in("i.type", TOOL_ITEM_TYPES)} THEN 'tool'
    ELSE 'info'
  END`;
  const itemAtSql = sql`COALESCE(json_extract(i.payload_json, '$.startedAt'), i.updated_at)`;
  const detailSql = sql`substr(COALESCE(
    CASE i.type
      WHEN 'command_execution' THEN json_extract(i.payload_json, '$.input')
      WHEN 'file_change' THEN json_extract(i.payload_json, '$.fileName')
      WHEN 'dynamic_tool' THEN COALESCE(json_extract(i.payload_json, '$.toolName'), 'tool')
        || COALESCE(' ' || json_extract(i.payload_json, '$.input'), '')
      WHEN 'subagent' THEN json_extract(i.payload_json, '$.prompt')
      WHEN 'error' THEN json_extract(i.payload_json, '$.failure.message')
      WHEN 'approval_request' THEN json_extract(i.payload_json, '$.prompt')
      WHEN 'user_input_request' THEN json_extract(i.payload_json, '$.questions[0].question')
      WHEN 'notification' THEN json_extract(i.payload_json, '$.summary')
      WHEN 'proposed_plan' THEN json_extract(i.payload_json, '$.markdown')
      WHEN 'todo_list' THEN json_extract(i.payload_json, '$.explanation')
      WHEN 'file_search' THEN json_extract(i.payload_json, '$.pattern')
      WHEN 'web_search' THEN json_extract(i.payload_json, '$.patterns[0]')
      WHEN 'compaction' THEN json_extract(i.payload_json, '$.summary')
      WHEN 'handoff' THEN json_extract(i.payload_json, '$.summary')
    END,
    json_extract(i.payload_json, '$.message')
  ), 1, ${DETAIL_CHARS})`;
  const activityColumns = sql`
    i.turn_item_id AS "activityId", i.thread_id AS "threadId", i.run_id AS "turnId",
    ${toneSql} AS tone, i.type AS kind, i.status, json_extract(i.payload_json, '$.title') AS title,
    ${detailSql} AS detail, ${itemAtSql} AS "createdAt"
  `;
  type ActivityRow = Omit<ActivityEntry, "summary"> & { readonly title: string | null };
  const activityEntryOf = ({ title, ...row }: ActivityRow): ActivityEntry => ({
    ...row,
    summary: activitySummary({ kind: row.kind, title }),
  });
  const workItems = sql`NOT (${sql.in("i.type", MESSAGE_ITEM_TYPES)})`;

  interface PlanRow {
    readonly planId: string;
    readonly threadId: string;
    readonly threadTitle: string;
    readonly projectId: string;
    readonly turnId: string | null;
    readonly status: string;
    readonly markdown: string | null;
    readonly markdownLength: number | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly implementedAt: string | null;
    readonly implementationThreadId: string | null;
  }

  /**
   * Proposed plans with their times and implementation. Plans carry no times
   * of their own: they come from the turn item that streamed the plan, else
   * its run. A plan was implemented when a run started from it
   * (`sourcePlanRef`), which is also when the plan moved to `completed`.
   */
  const planRows = (input: {
    readonly maxChars: number;
    readonly itemScope: Fragment;
    readonly conditions: ReadonlyArray<Fragment>;
  }) => sql`
    SELECT pl.plan_id AS "planId", pl.thread_id AS "threadId", t.title AS "threadTitle",
      t.project_id AS "projectId", pl.run_id AS "turnId", pl.status,
      substr(json_extract(pl.payload_json, '$.markdown'), 1, ${input.maxChars}) AS markdown,
      length(json_extract(pl.payload_json, '$.markdown')) AS "markdownLength",
      COALESCE(item.created_at, run.requested_at, t.created_at) AS "createdAt",
      COALESCE(item.updated_at, run.completed_at, run.requested_at, t.created_at) AS "updatedAt",
      impl.at AS "implementedAt", impl.thread_id AS "implementationThreadId"
    FROM orchestration_v2_projection_plans AS pl
    JOIN orchestration_v2_projection_threads AS t ON t.thread_id = pl.thread_id
    JOIN projection_projects AS p ON p.project_id = t.project_id
    LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = pl.run_id
    LEFT JOIN (
      SELECT i.thread_id, json_extract(i.payload_json, '$.planId') AS plan_id,
        MIN(${itemAtSql}) AS created_at, MAX(i.updated_at) AS updated_at
      FROM orchestration_v2_projection_turn_items AS i
      WHERE i.type = 'proposed_plan' AND ${input.itemScope}
      GROUP BY i.thread_id, plan_id
    ) AS item ON item.thread_id = pl.thread_id AND item.plan_id = pl.plan_id
    LEFT JOIN (
      SELECT json_extract(source.payload_json, '$.sourcePlanRef.planId') AS plan_id,
        MIN(source.requested_at) AS at, source.thread_id
      FROM orchestration_v2_projection_runs AS source
      WHERE json_extract(source.payload_json, '$.sourcePlanRef.planId') IS NOT NULL
      GROUP BY plan_id
    ) AS impl ON impl.plan_id = pl.plan_id
    WHERE ${sql.and([sql`pl.kind = 'proposed_plan'`, ...input.conditions])}
  `;

  const planEntryOf = (row: PlanRow): PlanEntry => ({
    planId: row.planId,
    threadId: row.threadId,
    threadTitle: row.threadTitle,
    turnId: row.turnId,
    title: planTitle(row.markdown ?? ""),
    preview: cut(row.markdown ?? "", 300).text ?? "",
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    implementedAt: row.implementedAt,
    implementationThreadId: row.implementationThreadId,
  });

  const listPlans = Effect.fn("QueryStore.listPlans")(function* (
    input: {
      readonly threadId?: string | undefined;
      readonly projectId?: string | undefined;
      readonly implemented?: boolean | undefined;
      readonly window?: Window | undefined;
    },
    page: PageRequest,
  ) {
    const window = input.window ?? OPEN_WINDOW;
    const rows = yield* sql<PlanRow>`
      SELECT * FROM (${planRows({
        maxChars: 600,
        itemScope: input.threadId === undefined ? sql`1 = 1` : sql`i.thread_id = ${input.threadId}`,
        conditions: scopeConditions(input),
      })})
      WHERE ${sql.and([
        ...(input.implemented === undefined
          ? []
          : [input.implemented ? sql`"implementedAt" IS NOT NULL` : sql`"implementedAt" IS NULL`]),
        sql`"createdAt" >= ${window.since}`,
        sql`"createdAt" < ${window.until}`,
        after(sql`"createdAt", "planId"`, page),
      ])}
      ORDER BY "createdAt" ${direction(page.order)}, "planId" ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(rows, page, (row) => [row.createdAt, row.planId], planEntryOf);
  });

  const getPlan = Effect.fn("QueryStore.getPlan")(function* (planId: string, maxChars: number) {
    const rows = yield* sql<PlanRow>`
      ${planRows({
        maxChars,
        itemScope: sql`i.thread_id = (
          SELECT thread_id FROM orchestration_v2_projection_plans WHERE plan_id = ${planId}
        )`,
        conditions: [liveThreads, sql`pl.plan_id = ${planId}`],
      })}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const markdown = row.markdown ?? "";
    const truncated = (row.markdownLength ?? 0) > maxChars;
    return {
      plan: planEntryOf(row),
      markdown: truncated ? `${markdown}…` : markdown,
      truncated,
    };
  });

  const getThreadDetail = Effect.fn("QueryStore.getThreadDetail")(function* (threadId: string) {
    const summary = yield* listThreads(
      { threadId, archived: "include" },
      { order: "desc", limit: 1, after: null },
    );
    const thread = summary.items[0];
    if (thread === undefined) return null;
    const sessions = yield* sql<{
      readonly status: string;
      readonly provider: string | null;
      readonly lastError: string | null;
      readonly updatedAt: string;
    }>`
      SELECT s.status, s.provider_instance_id AS provider,
        json_extract(s.payload_json, '$.lastError') AS "lastError", s.updated_at AS "updatedAt"
      FROM orchestration_v2_projection_provider_sessions AS s
      JOIN orchestration_v2_projection_provider_session_bindings AS b
        ON b.provider_session_id = s.provider_session_id
      WHERE b.thread_id = ${threadId}
      ORDER BY s.updated_at DESC, s.provider_session_id DESC LIMIT 1
    `;
    const activeRuns = yield* sql<{ readonly runId: string }>`
      SELECT run_id AS "runId" FROM orchestration_v2_projection_runs
      WHERE thread_id = ${threadId} AND ${sql.in("status", ACTIVE_RUN_STATUSES)}
      ORDER BY ordinal DESC LIMIT 1
    `;
    const messageCounts = yield* sql<{ readonly role: string; readonly count: number }>`
      SELECT role, COUNT(*) AS count FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} GROUP BY role
    `;
    const activityCounts = yield* sql<{ readonly tone: string; readonly count: number }>`
      SELECT ${toneSql} AS tone, COUNT(*) AS count FROM orchestration_v2_projection_turn_items AS i
      WHERE i.thread_id = ${threadId} AND ${workItems} GROUP BY tone
    `;
    const firstPrompt = yield* sql<{ readonly text: string | null }>`
      SELECT substr(json_extract(payload_json, '$.text'), 1, 2001) AS text
      FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} AND role = 'user'
      ORDER BY created_at ASC, message_id ASC LIMIT 1
    `;
    const latestResponse = yield* sql<{ readonly text: string | null }>`
      SELECT substr(json_extract(payload_json, '$.text'), 1, 2001) AS text
      FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} AND role = 'assistant'
      ORDER BY created_at DESC, message_id DESC LIMIT 1
    `;
    const pendingApprovals = yield* sql<{
      readonly requestId: string;
      readonly turnId: string | null;
      readonly kind: string;
      readonly prompt: string | null;
      readonly optionsJson: string | null;
      readonly createdAt: string;
    }>`
      SELECT rq.runtime_request_id AS "requestId", n.run_id AS "turnId", rq.kind,
        (SELECT COALESCE(json_extract(i.payload_json, '$.prompt'), json_extract(i.payload_json, '$.title'))
          FROM orchestration_v2_projection_turn_items AS i
          WHERE i.thread_id = rq.thread_id AND i.type = 'approval_request'
            AND json_extract(i.payload_json, '$.requestId') = rq.runtime_request_id
          ORDER BY i.updated_at DESC LIMIT 1) AS prompt,
        (SELECT json_extract(i.payload_json, '$.options')
          FROM orchestration_v2_projection_turn_items AS i
          WHERE i.thread_id = rq.thread_id AND i.type = 'approval_request'
            AND json_extract(i.payload_json, '$.requestId') = rq.runtime_request_id
          ORDER BY i.updated_at DESC LIMIT 1) AS "optionsJson",
        rq.created_at AS "createdAt"
      FROM orchestration_v2_projection_runtime_requests AS rq
      LEFT JOIN orchestration_v2_projection_nodes AS n ON n.node_id = rq.node_id
      WHERE rq.thread_id = ${threadId} AND rq.status = 'pending'
        AND ${sql.in("rq.kind", APPROVAL_KINDS)}
      ORDER BY rq.created_at ASC, rq.runtime_request_id ASC
    `;
    const plans = yield* listPlans({ threadId }, { order: "desc", limit: 20, after: null });
    const tabs = yield* sql<{
      readonly threadId: string;
      readonly title: string;
      readonly position: number;
    }>`
      SELECT tabs.thread_id AS "threadId", t.title, tabs.position
      FROM fork_thread_tabs AS tabs
      JOIN orchestration_v2_projection_threads AS t ON t.thread_id = tabs.thread_id
      WHERE tabs.group_id = (SELECT group_id FROM fork_thread_tabs WHERE thread_id = ${threadId})
        AND t.deleted_at IS NULL
      ORDER BY tabs.position ASC, tabs.created_at ASC
    `;
    const changedFiles = yield* filesBetween({
      threadId,
      fromTurnCount: 0,
      toTurnCount: Number.MAX_SAFE_INTEGER,
    });
    const session = sessions[0];
    return {
      thread,
      session:
        session === undefined ? null : { ...session, activeTurnId: activeRuns[0]?.runId ?? null },
      counts: {
        messagesByRole: Object.fromEntries(messageCounts.map((row) => [row.role, row.count])),
        activitiesByTone: Object.fromEntries(activityCounts.map((row) => [row.tone, row.count])),
      },
      firstPrompt: cut(firstPrompt[0]?.text ?? null, 2000).text,
      latestResponse: cut(latestResponse[0]?.text ?? null, 2000).text,
      pendingApprovals: pendingApprovals.map(({ optionsJson, ...approval }) => ({
        ...approval,
        options: parseJson(optionsJson),
      })),
      plans: plans.items,
      tabs,
      changedFiles: changedFiles.slice(0, MAX_CHANGED_FILES),
      changedFilesTruncated: changedFiles.length > MAX_CHANGED_FILES,
    };
  });

  interface ProjectRow {
    readonly projectId: string;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly createdAt: string;
    readonly lastActivityAt: string | null;
    readonly threadCount: number;
    readonly archivedThreadCount: number;
    readonly sortAt: string;
    readonly defaultModelSelectionJson: string | null;
    readonly scriptsJson: string;
  }

  const listProjectRows = (input: {
    readonly projectId?: string | undefined;
    readonly window?: Window | undefined;
    readonly page: PageRequest;
  }) => sql<ProjectRow>`
    SELECT * FROM (
      SELECT
        p.project_id AS "projectId",
        p.title,
        p.workspace_root AS "workspaceRoot",
        p.created_at AS "createdAt",
        MAX(CASE WHEN t.thread_id IS NULL THEN NULL ELSE ${lastActivitySql} END) AS "lastActivityAt",
        COUNT(CASE WHEN t.thread_id IS NOT NULL AND t.archived_at IS NULL THEN 1 END) AS "threadCount",
        COUNT(CASE WHEN t.archived_at IS NOT NULL THEN 1 END) AS "archivedThreadCount",
        COALESCE(
          MAX(CASE WHEN t.thread_id IS NULL THEN NULL ELSE ${lastActivitySql} END),
          p.created_at
        ) AS "sortAt",
        p.default_model_selection_json AS "defaultModelSelectionJson",
        p.scripts_json AS "scriptsJson"
      FROM projection_projects AS p
      LEFT JOIN orchestration_v2_projection_threads AS t
        ON t.project_id = p.project_id AND t.deleted_at IS NULL AND ${notSubagent}
      WHERE ${sql.and([
        sql`p.deleted_at IS NULL`,
        ...(input.projectId === undefined ? [] : [sql`p.project_id = ${input.projectId}`]),
        ...(input.window === undefined
          ? []
          : [
              sql`p.project_id IN (
                SELECT active.project_id FROM orchestration_v2_projection_threads AS active
                WHERE active.deleted_at IS NULL
                  AND active.thread_id IN (SELECT thread_id FROM (${activitySql(input.window)}))
              )`,
            ]),
      ])}
      GROUP BY p.project_id
    )
    WHERE ${after(sql`"sortAt", "projectId"`, input.page)}
    ORDER BY "sortAt" ${direction(input.page.order)}, "projectId" ${direction(input.page.order)}
    LIMIT ${input.page.limit + 1}
  `;

  const projectSummaryOf = (row: ProjectRow): ProjectSummary => ({
    projectId: row.projectId,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    threadCount: row.threadCount,
    archivedThreadCount: row.archivedThreadCount,
  });

  const listProjects = Effect.fn("QueryStore.listProjects")(function* (
    window: Window | undefined,
    page: PageRequest,
  ) {
    const rows = yield* listProjectRows({ window, page });
    return pageOf(rows, page, (row) => [row.sortAt, row.projectId], projectSummaryOf);
  });

  const getProject = Effect.fn("QueryStore.getProject")(function* (projectId: string) {
    const rows = yield* listProjectRows({
      projectId,
      page: { order: "desc", limit: 1, after: null },
    });
    const row = rows[0];
    if (row === undefined) return null;
    const recent = yield* listThreads({ projectId }, { order: "desc", limit: 10, after: null });
    const defaultModel = parseJson(row.defaultModelSelectionJson);
    const scripts = parseJson(row.scriptsJson);
    return {
      project: projectSummaryOf(row),
      defaultModel: isRecord(defaultModel) ? stringField(defaultModel, "model") : null,
      scripts: Array.isArray(scripts)
        ? scripts.flatMap((script) =>
            isRecord(script) &&
            typeof script.name === "string" &&
            typeof script.command === "string"
              ? [{ name: script.name, command: script.command }]
              : [],
          )
        : [],
      recentThreads: recent.items,
    };
  });

  const countEnvironment = Effect.fn("QueryStore.countEnvironment")(function* () {
    const rows = yield* sql<{
      readonly projects: number;
      readonly threads: number;
      readonly archivedThreads: number;
    }>`
      SELECT
        (SELECT COUNT(*) FROM projection_projects WHERE deleted_at IS NULL) AS projects,
        (SELECT COUNT(*) ${threadsFrom}
          WHERE ${liveThreads} AND ${notSubagent} AND t.archived_at IS NULL) AS threads,
        (SELECT COUNT(*) ${threadsFrom}
          WHERE ${liveThreads} AND ${notSubagent} AND t.archived_at IS NOT NULL) AS "archivedThreads"
    `;
    return rows[0] ?? { projects: 0, threads: 0, archivedThreads: 0 };
  });

  const timeline = Effect.fn("QueryStore.timeline")(function* (
    input: {
      readonly window: Window;
      readonly projectId?: string | undefined;
      readonly threadId?: string | undefined;
      readonly kinds?: ReadonlyArray<TimelineKind> | undefined;
    },
    page: PageRequest,
  ) {
    const { since, until } = input.window;
    const inWindow = (column: Fragment) => sql`${column} >= ${since} AND ${column} < ${until}`;
    const rows = yield* sql<TimelineEntry>`
      WITH feed AS (
        SELECT t.created_at AS at, 'thread.created' AS kind, t.thread_id AS id,
          t.thread_id AS thread_id, NULL AS turn_id, t.title AS summary
        FROM orchestration_v2_projection_threads AS t WHERE ${inWindow(sql`t.created_at`)}
        UNION ALL
        SELECT m.created_at, 'prompt', m.message_id, m.thread_id, m.run_id,
          substr(json_extract(m.payload_json, '$.text'), 1, ${TIMELINE_PROMPT_CHARS})
        FROM orchestration_v2_projection_messages AS m
        WHERE m.role = 'user' AND ${inWindow(sql`m.created_at`)}
        UNION ALL
        SELECT r.completed_at, 'turn.completed', r.run_id, r.thread_id, r.run_id,
          r.status || ' · ' || COALESCE(json_array_length(cp.payload_json, '$.files'), 0) || ' files +'
            || (SELECT COALESCE(SUM(json_extract(value, '$.additions')), 0) FROM json_each(cp.payload_json, '$.files'))
            || ' -'
            || (SELECT COALESCE(SUM(json_extract(value, '$.deletions')), 0) FROM json_each(cp.payload_json, '$.files'))
            || COALESCE(' · ' || substr((
              SELECT json_extract(reply.payload_json, '$.text') FROM orchestration_v2_projection_messages AS reply
              WHERE reply.run_id = r.run_id AND reply.role = 'assistant'
              ORDER BY reply.created_at DESC, reply.message_id DESC LIMIT 1
            ), 1, ${TIMELINE_SUMMARY_CHARS}), '')
        FROM orchestration_v2_projection_runs AS r
        ${runCheckpointJoin}
        WHERE ${inWindow(sql`r.completed_at`)}
        UNION ALL
        SELECT plan."createdAt", 'plan.proposed', plan."planId", plan."threadId", plan."turnId",
          plan.markdown
        FROM (${planRows({ maxChars: TIMELINE_SUMMARY_CHARS, itemScope: sql`1 = 1`, conditions: [] })}) AS plan
        WHERE ${inWindow(sql`plan."createdAt"`)}
        UNION ALL
        SELECT plan."implementedAt", 'plan.implemented', plan."planId", plan."threadId", plan."turnId",
          plan.markdown
        FROM (${planRows({ maxChars: TIMELINE_SUMMARY_CHARS, itemScope: sql`1 = 1`, conditions: [] })}) AS plan
        WHERE ${inWindow(sql`plan."implementedAt"`)}
        UNION ALL
        SELECT pr."linkedAt", 'pull_request.linked', pr.url, pr."threadId", NULL,
          pr.repository || '#' || pr.number || COALESCE(' ' || json_extract(pr."snapshotJson", '$.title'), '')
        FROM (${pullRequestRows([liveThreads])}) AS pr
        WHERE ${inWindow(sql`pr."linkedAt"`)}
        UNION ALL
        SELECT rq.created_at, 'approval.requested', rq.runtime_request_id, rq.thread_id, n.run_id,
          'Approval requested · ' || rq.kind
            || COALESCE(' · ' || json_extract(rq.payload_json, '$.decision'), '')
        FROM orchestration_v2_projection_runtime_requests AS rq
        LEFT JOIN orchestration_v2_projection_nodes AS n ON n.node_id = rq.node_id
        WHERE ${sql.in("rq.kind", APPROVAL_KINDS)} AND ${inWindow(sql`rq.created_at`)}
        UNION ALL
        SELECT ${itemAtSql}, 'error', i.turn_item_id, i.thread_id, i.run_id,
          COALESCE(json_extract(i.payload_json, '$.title'), 'Error')
            || COALESCE(': ' || substr(json_extract(i.payload_json, '$.failure.message'), 1, ${DETAIL_CHARS}), '')
        FROM orchestration_v2_projection_turn_items AS i
        WHERE i.type = 'error' AND ${inWindow(itemAtSql)}
        UNION ALL
        SELECT t.archived_at, 'thread.archived', t.thread_id, t.thread_id, NULL, t.title
        FROM orchestration_v2_projection_threads AS t WHERE ${inWindow(sql`t.archived_at`)}
        UNION ALL
        SELECT json_extract(t.payload_json, '$.settledAt'), 'thread.settled', t.thread_id, t.thread_id,
          NULL, t.title
        FROM orchestration_v2_projection_threads AS t
        WHERE json_extract(t.payload_json, '$.settledOverride') IS NOT 'active'
          AND ${inWindow(sql`json_extract(t.payload_json, '$.settledAt')`)}
      )
      SELECT feed.at, feed.kind, feed.id, feed.thread_id AS "threadId", t.title AS "threadTitle",
        t.project_id AS "projectId", p.title AS "projectTitle", feed.turn_id AS "turnId",
        COALESCE(feed.summary, '') AS summary
      FROM feed
      JOIN orchestration_v2_projection_threads AS t ON t.thread_id = feed.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE ${sql.and([
        ...scopeConditions(input),
        ...(input.kinds === undefined || input.kinds.length === 0
          ? []
          : [sql.in("feed.kind", input.kinds)]),
        after(sql`feed.at, feed.kind, feed.id`, page),
      ])}
      ORDER BY feed.at ${direction(page.order)}, feed.kind ${direction(page.order)},
        feed.id ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(
      rows,
      page,
      (row) => [row.at, row.kind, row.id],
      (row): TimelineEntry => ({ ...row, summary: oneLine(row.summary) }),
    );
  });

  interface TurnRow {
    readonly turnId: string;
    readonly threadId: string;
    readonly ordinal: number;
    readonly turnCount: number | null;
    readonly state: string;
    readonly requestedAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly prompt: string | null;
    readonly response: string | null;
    readonly filesJson: string | null;
    readonly sourcePlanId: string | null;
  }

  const turnSelect = (maxChars: number) => sql`
    SELECT r.run_id AS "turnId", r.thread_id AS "threadId", r.ordinal,
      cp.app_run_ordinal AS "turnCount", r.status AS state, r.requested_at AS "requestedAt",
      json_extract(r.payload_json, '$.startedAt') AS "startedAt", r.completed_at AS "completedAt",
      substr(json_extract(prompt.payload_json, '$.text'), 1, ${maxChars + 1}) AS prompt,
      substr((
        SELECT json_extract(reply.payload_json, '$.text') FROM orchestration_v2_projection_messages AS reply
        WHERE reply.run_id = r.run_id AND reply.role = 'assistant'
        ORDER BY reply.created_at DESC, reply.message_id DESC LIMIT 1
      ), 1, ${maxChars + 1}) AS response,
      json_extract(cp.payload_json, '$.files') AS "filesJson",
      json_extract(r.payload_json, '$.sourcePlanRef.planId') AS "sourcePlanId"
    FROM orchestration_v2_projection_runs AS r
    LEFT JOIN orchestration_v2_projection_messages AS prompt
      ON prompt.message_id = json_extract(r.payload_json, '$.userMessageId')
    ${runCheckpointJoin}
  `;

  const turnSummaryOf =
    (maxChars: number) =>
    (row: TurnRow): TurnSummary => {
      const files = parseFiles(row.filesJson);
      const prompt = cut(row.prompt, maxChars);
      const response = cut(row.response, maxChars);
      return {
        turnId: row.turnId,
        threadId: row.threadId,
        turnCount: row.turnCount,
        state: row.state,
        requestedAt: row.requestedAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        prompt: prompt.text,
        response: response.text,
        truncated: prompt.truncated || response.truncated,
        fileCount: files.length,
        ...fileTotals(files),
        files,
        sourcePlanId: row.sourcePlanId,
      };
    };

  const listTurns = Effect.fn("QueryStore.listTurns")(function* (
    input: { readonly threadId: string; readonly window: Window; readonly maxChars: number },
    page: PageRequest,
  ) {
    const rows = yield* sql<TurnRow>`
      ${turnSelect(input.maxChars)}
      WHERE ${sql.and([
        sql`r.thread_id = ${input.threadId}`,
        sql`r.requested_at >= ${input.window.since}`,
        sql`r.requested_at < ${input.window.until}`,
        after(sql`r.requested_at, r.ordinal`, page),
      ])}
      ORDER BY r.requested_at ${direction(page.order)}, r.ordinal ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(
      rows,
      page,
      (row) => [row.requestedAt, row.ordinal],
      turnSummaryOf(input.maxChars),
    );
  });

  const getTurn = Effect.fn("QueryStore.getTurn")(function* (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly maxChars: number;
  }) {
    const rows = yield* sql<TurnRow>`
      ${turnSelect(input.maxChars)}
      WHERE r.thread_id = ${input.threadId} AND r.run_id = ${input.turnId}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const counts = yield* sql<{ readonly kind: string; readonly count: number }>`
      SELECT i.type AS kind, COUNT(*) AS count FROM orchestration_v2_projection_turn_items AS i
      WHERE i.thread_id = ${input.threadId} AND i.run_id = ${input.turnId} AND ${workItems}
      GROUP BY i.type
    `;
    const notable = yield* sql<ActivityRow>`
      SELECT ${activityColumns} FROM orchestration_v2_projection_turn_items AS i
      WHERE i.thread_id = ${input.threadId} AND i.run_id = ${input.turnId}
        AND (i.type = 'error' OR ${sql.in("i.type", NOTABLE_ITEM_TYPES)})
      ORDER BY i.ordinal DESC, i.turn_item_id DESC LIMIT 40
    `;
    return {
      turn: turnSummaryOf(input.maxChars)(row),
      activityCounts: Object.fromEntries(counts.map((count) => [count.kind, count.count])),
      notableActivities: notable.toReversed().map(activityEntryOf),
    };
  });

  const turnCountOf = Effect.fn("QueryStore.turnCountOf")(function* (
    threadId: string,
    turnId: string,
  ) {
    const rows = yield* sql<{ readonly turnCount: number | null }>`
      SELECT cp.app_run_ordinal AS "turnCount" FROM orchestration_v2_projection_runs AS r
      ${runCheckpointJoin}
      WHERE r.thread_id = ${threadId} AND r.run_id = ${turnId}
    `;
    return rows[0];
  });

  const threadExists = Effect.fn("QueryStore.threadExists")(function* (threadId: string) {
    const rows = yield* sql<{ readonly found: number }>`
      SELECT 1 AS found ${threadsFrom} WHERE t.thread_id = ${threadId} AND ${liveThreads}
    `;
    return rows.length > 0;
  });

  interface MessageRow {
    readonly messageId: string;
    readonly threadId: string;
    readonly threadTitle: string;
    readonly turnId: string | null;
    readonly role: string;
    readonly createdBy: string | null;
    readonly createdAt: string;
    readonly isStreaming: number;
    readonly text: string | null;
    readonly attachmentCount: number;
    readonly attachmentsJson: string | null;
    readonly contextJson: string | null;
  }

  /** Messages, plus reasoning turn items as role `reasoning` when asked. */
  const messageSource = (includeReasoning: boolean) => sql`
    SELECT message_id AS id, thread_id, run_id, role, streaming, created_at,
      json_extract(payload_json, '$.text') AS text,
      json_extract(payload_json, '$.createdBy') AS created_by,
      json_extract(payload_json, '$.attachments') AS attachments_json,
      json_extract(payload_json, '$.context') AS context_json
    FROM orchestration_v2_projection_messages
    ${
      includeReasoning
        ? sql`UNION ALL
          SELECT i.turn_item_id, i.thread_id, i.run_id, 'reasoning',
            CASE WHEN json_extract(i.payload_json, '$.streaming') THEN 1 ELSE 0 END, ${itemAtSql},
            json_extract(i.payload_json, '$.text'), 'agent', NULL, NULL
          FROM orchestration_v2_projection_turn_items AS i WHERE i.type = 'reasoning'`
        : sql``
    }
  `;

  const messageSelect = (maxChars: number, includeReasoning: boolean) => sql`
    SELECT m.id AS "messageId", m.thread_id AS "threadId", t.title AS "threadTitle",
      m.run_id AS "turnId", m.role, m.created_by AS "createdBy", m.created_at AS "createdAt",
      m.streaming AS "isStreaming", substr(m.text, 1, ${maxChars + 1}) AS text,
      CASE WHEN json_valid(m.attachments_json) THEN json_array_length(m.attachments_json) ELSE 0 END
        AS "attachmentCount",
      m.attachments_json AS "attachmentsJson", m.context_json AS "contextJson"
    FROM (${messageSource(includeReasoning)}) AS m
    JOIN orchestration_v2_projection_threads AS t ON t.thread_id = m.thread_id
    JOIN projection_projects AS p ON p.project_id = t.project_id
  `;

  const messageEntryOf =
    (maxChars: number) =>
    (row: MessageRow): MessageEntry => {
      const text = cut(row.text ?? "", maxChars);
      return {
        messageId: row.messageId,
        threadId: row.threadId,
        threadTitle: row.threadTitle,
        turnId: row.turnId,
        role: row.role,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        isStreaming: row.isStreaming === 1,
        text: text.text ?? "",
        truncated: text.truncated,
        attachmentCount: row.attachmentCount,
      };
    };

  const roleCondition = (role: "user" | "assistant" | "any", includeReasoning: boolean) =>
    role === "any"
      ? includeReasoning
        ? sql`1 = 1`
        : sql`m.role IN ('user', 'assistant', 'system')`
      : includeReasoning && role === "assistant"
        ? sql`m.role IN ('assistant', 'reasoning')`
        : sql`m.role = ${role}`;

  const listMessages = Effect.fn("QueryStore.listMessages")(function* (
    input: {
      readonly threadId?: string | undefined;
      readonly projectId?: string | undefined;
      readonly role: "user" | "assistant" | "any";
      readonly includeReasoning: boolean;
      readonly window: Window;
      readonly maxChars: number;
    },
    page: PageRequest,
  ) {
    const includeReasoning = input.includeReasoning && input.role !== "user";
    const rows = yield* sql<MessageRow>`
      ${messageSelect(input.maxChars, includeReasoning)}
      WHERE ${sql.and([
        ...scopeConditions(input),
        roleCondition(input.role, includeReasoning),
        sql`m.created_at >= ${input.window.since}`,
        sql`m.created_at < ${input.window.until}`,
        after(sql`m.created_at, m.id`, page),
      ])}
      ORDER BY m.created_at ${direction(page.order)}, m.id ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(
      rows,
      page,
      (row) => [row.createdAt, row.messageId],
      messageEntryOf(input.maxChars),
    );
  });

  const getMessage = Effect.fn("QueryStore.getMessage")(function* (
    messageId: string,
    maxChars: number,
  ) {
    const rows = yield* sql<MessageRow>`
      ${messageSelect(maxChars, false)} WHERE m.id = ${messageId} AND ${liveThreads}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const attachments = parseJson(row.attachmentsJson);
    return {
      message: messageEntryOf(maxChars)(row),
      attachments: Array.isArray(attachments)
        ? attachments.filter(isRecord).map((attachment) => ({
            type: stringField(attachment, "type") ?? "unknown",
            name: stringField(attachment, "name"),
            mimeType: stringField(attachment, "mimeType"),
            sizeBytes: intField(attachment, "sizeBytes"),
          }))
        : [],
      context: parseJson(row.contextJson),
    };
  });

  const search = Effect.fn("QueryStore.search")(function* (input: {
    readonly query: string;
    readonly projectId?: string | undefined;
    readonly threadId?: string | undefined;
    readonly role: "user" | "assistant" | "any";
    readonly window: Window;
    readonly limit: number;
  }) {
    const pattern = likePattern(input.query);
    const scope = scopeConditions(input);
    const threads = yield* sql<{
      readonly threadId: string;
      readonly title: string;
      readonly projectTitle: string;
      readonly lastActivityAt: string;
    }>`
      SELECT t.thread_id AS "threadId", t.title, p.title AS "projectTitle",
        ${lastActivitySql} AS "lastActivityAt"
      ${threadsFrom}
      WHERE ${sql.and([...scope, sql`t.title LIKE ${pattern} ESCAPE '!'`])}
      ORDER BY "lastActivityAt" DESC LIMIT 10
    `;
    const messages = yield* sql<{
      readonly messageId: string;
      readonly threadId: string;
      readonly threadTitle: string;
      readonly role: string;
      readonly createdAt: string;
      readonly snippet: string;
    }>`
      SELECT m.message_id AS "messageId", m.thread_id AS "threadId", t.title AS "threadTitle",
        m.role, m.created_at AS "createdAt",
        substr(m.text, MAX(1, instr(lower(m.text), lower(${input.query})) - 100), 240) AS snippet
      FROM (
        SELECT message_id, thread_id, role, created_at, json_extract(payload_json, '$.text') AS text
        FROM orchestration_v2_projection_messages
        WHERE ${sql.and([
          input.role === "any" ? sql`role IN ('user', 'assistant')` : sql`role = ${input.role}`,
          sql`created_at >= ${input.window.since}`,
          sql`created_at < ${input.window.until}`,
        ])}
      ) AS m
      JOIN orchestration_v2_projection_threads AS t ON t.thread_id = m.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE ${sql.and([...scope, sql`m.text LIKE ${pattern} ESCAPE '!'`])}
      ORDER BY m.created_at DESC, m.message_id DESC LIMIT ${input.limit}
    `;
    return {
      threads,
      messages: messages.map((message) => ({ ...message, snippet: oneLine(message.snippet) })),
    };
  });

  const listActivities = Effect.fn("QueryStore.listActivities")(function* (
    input: {
      readonly threadId?: string | undefined;
      readonly turnId?: string | undefined;
      readonly projectId?: string | undefined;
      readonly tone?: string | undefined;
      readonly kinds?: ReadonlyArray<string> | undefined;
      readonly window: Window;
    },
    page: PageRequest,
  ) {
    const rows = yield* sql<ActivityRow>`
      SELECT * FROM (
        SELECT ${activityColumns}
        FROM orchestration_v2_projection_turn_items AS i
        JOIN orchestration_v2_projection_threads AS t ON t.thread_id = i.thread_id
        JOIN projection_projects AS p ON p.project_id = t.project_id
        WHERE ${sql.and([
          ...scopeConditions(input),
          workItems,
          ...(input.turnId === undefined ? [] : [sql`i.run_id = ${input.turnId}`]),
          ...(input.kinds === undefined || input.kinds.length === 0
            ? []
            : [sql.in("i.type", input.kinds)]),
        ])}
      )
      WHERE ${sql.and([
        ...(input.tone === undefined ? [] : [sql`tone = ${input.tone}`]),
        sql`"createdAt" >= ${input.window.since}`,
        sql`"createdAt" < ${input.window.until}`,
        after(sql`"createdAt", "activityId"`, page),
      ])}
      ORDER BY "createdAt" ${direction(page.order)}, "activityId" ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(rows, page, (row) => [row.createdAt, row.activityId], activityEntryOf);
  });

  const getActivity = Effect.fn("QueryStore.getActivity")(function* (
    activityId: string,
    maxChars: number,
  ) {
    const rows = yield* sql<
      ActivityRow & { readonly payload: string; readonly payloadLength: number }
    >`
      SELECT ${activityColumns},
        substr(i.payload_json, 1, ${maxChars}) AS payload, length(i.payload_json) AS "payloadLength"
      FROM orchestration_v2_projection_turn_items AS i
      JOIN orchestration_v2_projection_threads AS t ON t.thread_id = i.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE i.turn_item_id = ${activityId} AND ${liveThreads} AND ${workItems}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const { payload, payloadLength, ...activity } = row;
    const truncated = payloadLength > maxChars;
    return {
      activity: activityEntryOf(activity),
      payload: truncated ? `${payload}…` : parseJson(payload),
      truncated,
    };
  });

  /**
   * A subagent's conversation from the thread T3 Code keeps for it. `taskId`
   * may be the subagent id, the subagent activity's id, or the child thread id.
   */
  const getSubagentTranscript = Effect.fn("QueryStore.getSubagentTranscript")(function* (input: {
    readonly threadId: string;
    readonly taskId: string;
  }) {
    const subagents = yield* sql<{
      readonly subagentId: string;
      readonly childThreadId: string | null;
      readonly status: string;
      readonly title: string | null;
      readonly prompt: string | null;
      readonly result: string | null;
      readonly startedAt: string | null;
      readonly completedAt: string | null;
    }>`
      SELECT s.subagent_id AS "subagentId", s.child_thread_id AS "childThreadId", s.status,
        json_extract(s.payload_json, '$.title') AS title,
        json_extract(s.payload_json, '$.prompt') AS prompt,
        json_extract(s.payload_json, '$.result') AS result,
        s.started_at AS "startedAt", s.completed_at AS "completedAt"
      FROM orchestration_v2_projection_subagents AS s
      WHERE s.thread_id = ${input.threadId}
        AND (
          s.subagent_id = ${input.taskId}
          OR s.child_thread_id = ${input.taskId}
          OR s.subagent_id = (
            SELECT json_extract(i.payload_json, '$.subagentId')
            FROM orchestration_v2_projection_turn_items AS i
            WHERE i.turn_item_id = ${input.taskId} AND i.thread_id = ${input.threadId}
          )
        )
      ORDER BY s.updated_at DESC LIMIT 1
    `;
    const subagent = subagents[0];
    if (subagent === undefined) return null;
    const items =
      subagent.childThreadId === null
        ? []
        : yield* sql<{
            readonly type: string;
            readonly status: string;
            readonly title: string | null;
            readonly text: string | null;
            readonly toolName: string | null;
            readonly input: string | null;
            readonly output: string | null;
            readonly at: string;
          }>`
            SELECT i.type, i.status, json_extract(i.payload_json, '$.title') AS title,
              substr(json_extract(i.payload_json, '$.text'), 1, ${TRANSCRIPT_TEXT_CHARS + 1}) AS text,
              CASE i.type
                WHEN 'dynamic_tool' THEN json_extract(i.payload_json, '$.toolName')
                WHEN 'command_execution' THEN 'command'
                ELSE i.type
              END AS "toolName",
              substr(COALESCE(
                CASE i.type
                  WHEN 'file_change' THEN json_extract(i.payload_json, '$.fileName')
                  WHEN 'subagent' THEN json_extract(i.payload_json, '$.prompt')
                  WHEN 'file_search' THEN json_extract(i.payload_json, '$.pattern')
                  WHEN 'web_search' THEN json_extract(i.payload_json, '$.patterns')
                END,
                json_extract(i.payload_json, '$.input')
              ), 1, ${TRANSCRIPT_TEXT_CHARS + 1}) AS input,
              substr(COALESCE(
                json_extract(i.payload_json, '$.output'),
                json_extract(i.payload_json, '$.result'),
                json_extract(i.payload_json, '$.diffStr')
              ), 1, ${TRANSCRIPT_TEXT_CHARS + 1}) AS output,
              ${itemAtSql} AS at
            FROM orchestration_v2_projection_turn_items AS i
            WHERE i.thread_id = ${subagent.childThreadId}
              AND ${sql.in("i.type", [...MESSAGE_ITEM_TYPES, ...TOOL_ITEM_TYPES])}
            ORDER BY i.ordinal DESC, i.turn_item_id DESC
            LIMIT ${TRANSCRIPT_ENTRIES + 1}
          `;
    let truncated = items.length > TRANSCRIPT_ENTRIES;
    const capped = (text: string | null) => {
      const result = cut(text, TRANSCRIPT_TEXT_CHARS);
      truncated ||= result.truncated;
      return result.text;
    };
    const entries = items
      .slice(0, TRANSCRIPT_ENTRIES)
      .toReversed()
      .map((item): SubagentTranscriptEntry => {
        const kind =
          item.type === "user_message"
            ? "user"
            : item.type === "assistant_message"
              ? "assistant"
              : item.type === "reasoning"
                ? "reasoning"
                : "tool";
        if (kind !== "tool") return { kind, text: capped(item.text) ?? "", at: item.at };
        const input = capped(item.input);
        const output = capped(item.output);
        return {
          kind,
          text: item.title ?? ACTIVITY_LABELS[item.type] ?? item.type,
          ...(item.toolName === null ? {} : { toolName: item.toolName }),
          ...(input === null ? {} : { input }),
          ...(output === null ? {} : { output }),
          status: item.status,
          at: item.at,
        };
      });
    const prompt = subagent.prompt ?? "";
    return {
      taskId: subagent.subagentId,
      childThreadId: subagent.childThreadId,
      title: subagent.title,
      status: subagent.status,
      prompt,
      result: subagent.result,
      startedAt: subagent.startedAt,
      completedAt: subagent.completedAt,
      // Without a thread of its own, the prompt and result are all that was kept.
      entries:
        entries.length > 0
          ? entries
          : [
              { kind: "user" as const, text: capped(prompt) ?? "" },
              ...(subagent.result === null
                ? []
                : [{ kind: "assistant" as const, text: capped(subagent.result) ?? "" }]),
            ],
      truncated,
    } satisfies SubagentTranscript;
  });

  const listPullRequests = Effect.fn("QueryStore.listPullRequests")(function* (
    input: {
      readonly threadId?: string | undefined;
      readonly projectId?: string | undefined;
      readonly state?: string | undefined;
      readonly window?: Window | undefined;
    },
    page: PageRequest,
  ) {
    const window = input.window ?? OPEN_WINDOW;
    const rows = yield* sql<PullRequestRow>`
      SELECT * FROM (${pullRequestRows(scopeConditions(input))})
      WHERE ${sql.and([
        ...(input.state === undefined
          ? []
          : [sql`json_extract("snapshotJson", '$.state') = ${input.state}`]),
        sql`"linkedAt" >= ${window.since}`,
        sql`"linkedAt" < ${window.until}`,
        after(sql`"linkedAt", "threadId", url`, page),
      ])}
      ORDER BY "linkedAt" ${direction(page.order)}, "threadId" ${direction(page.order)},
        url ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(rows, page, (row) => [row.linkedAt, row.threadId, row.url], pullRequestEntryOf);
  });

  const getPullRequest = Effect.fn("QueryStore.getPullRequest")(function* (key: {
    readonly host: string | null;
    readonly repository: string;
    readonly number: number;
  }) {
    const rows = yield* sql<PullRequestRow>`
      SELECT * FROM (${pullRequestRows([liveThreads])})
      WHERE lower(repository) = ${key.repository.toLowerCase()} AND number = ${key.number}
      ORDER BY "linkedAt" ASC
    `;
    const host = key.host;
    return rows.map(pullRequestEntryOf).filter(
      (entry) =>
        host === null ||
        threadPullRequestKeysEqual(entry, {
          host,
          repository: key.repository,
          number: key.number,
        }),
    );
  });

  return {
    listThreads,
    getThreadDetail,
    listProjects,
    getProject,
    countEnvironment,
    timeline,
    listTurns,
    getTurn,
    turnCountOf,
    filesBetween,
    threadExists,
    listMessages,
    getMessage,
    search,
    listActivities,
    getActivity,
    getSubagentTranscript,
    listPlans,
    getPlan,
    listPullRequests,
    getPullRequest,
  };
});
