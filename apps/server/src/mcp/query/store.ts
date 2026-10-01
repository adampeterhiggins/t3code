import type { OrchestrationCheckpointFile } from "@t3tools/contracts";
import { threadPullRequestKeysEqual } from "@t3tools/shared/threadPullRequests";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Fragment } from "effect/unstable/sql/Statement";

import type {
  ActivityEntry,
  MessageEntry,
  PlanEntry,
  ProjectSummary,
  PullRequestBrief,
  PullRequestEntry,
  ThreadSummary,
  TimelineEntry,
  TimelineKind,
  TurnSummary,
} from "./tools.ts";

/**
 * SQL behind the query toolkit. Everything reads the projection tables the
 * app renders from, so what an agent sees matches what the user saw. Deleted
 * threads and projects never appear. Times are the projections' own ISO UTC
 * strings, which compare correctly as text.
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

/** Escapes LIKE wildcards; queries pass `ESCAPE '!'`. */
export const likePattern = (text: string) => `%${text.replace(/[!%_]/g, (char) => `!${char}`)}%`;

const cut = (text: string | null, max: number) =>
  text === null
    ? { text: null, truncated: false }
    : text.length > max
      ? { text: `${text.slice(0, max)}…`, truncated: true }
      : { text, truncated: false };

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

export const parseFiles = (json: string | null): ReadonlyArray<OrchestrationCheckpointFile> => {
  const parsed = parseJson(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): ReadonlyArray<OrchestrationCheckpointFile> => {
    if (!isRecord(entry) || typeof entry.path !== "string") return [];
    return [
      {
        path: entry.path,
        kind: typeof entry.kind === "string" ? entry.kind : "modified",
        additions: intField(entry, "additions") ?? 0,
        deletions: intField(entry, "deletions") ?? 0,
      } as OrchestrationCheckpointFile,
    ];
  });
};

/** Sums file changes across turns, oldest first, so the latest kind wins. */
export const mergeFiles = (
  turns: ReadonlyArray<ReadonlyArray<OrchestrationCheckpointFile>>,
): ReadonlyArray<OrchestrationCheckpointFile> => {
  const byPath = new Map<string, OrchestrationCheckpointFile>();
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

const planTitle = (markdown: string) => {
  const line = markdown
    .split("\n")
    .map((candidate) => candidate.replace(/^#+\s*/, "").trim())
    .find((candidate) => candidate.length > 0);
  return cut(line ?? "Untitled plan", 120).text ?? "Untitled plan";
};

const pullRequestOf = (row: {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly snapshotJson: string | null;
}) => {
  const parsed = parseJson(row.snapshotJson);
  const snapshot = isRecord(parsed) ? parsed : {};
  return {
    host: row.host,
    repository: row.repository,
    number: row.number,
    url: row.url,
    title: stringField(snapshot, "title"),
    state: stringField(snapshot, "state"),
    isDraft: typeof snapshot.isDraft === "boolean" ? snapshot.isDraft : null,
    snapshot,
  };
};

interface PullRequestRow {
  readonly host: string;
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

const pullRequestEntryOf = (row: PullRequestRow): PullRequestEntry => {
  const { snapshot, ...brief } = pullRequestOf(row);
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
  readonly providerName: string | null;
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
  readonly sessionStatus: string | null;
  readonly turnCount: number;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly hasActionableProposedPlan: number;
  readonly tabGroupId: string | null;
  readonly startedByThreadId: string | null;
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

  const lastActivitySql = sql`MAX(
    COALESCE(t.latest_user_message_at, t.created_at),
    COALESCE(
      (SELECT MAX(COALESCE(tu.completed_at, tu.started_at, tu.requested_at))
        FROM projection_turns AS tu WHERE tu.thread_id = t.thread_id),
      t.created_at
    )
  )`;

  const liveThreads = sql`t.deleted_at IS NULL AND p.deleted_at IS NULL`;

  /** Threads with a prompt, a turn start, or a turn finish inside the window. */
  const activitySql = (window: Window) => sql`
    SELECT thread_id, created_at AS at FROM projection_thread_messages
      WHERE role = 'user' AND created_at >= ${window.since} AND created_at < ${window.until}
    UNION ALL
    SELECT thread_id, requested_at FROM projection_turns
      WHERE requested_at >= ${window.since} AND requested_at < ${window.until}
    UNION ALL
    SELECT thread_id, completed_at FROM projection_turns
      WHERE completed_at >= ${window.since} AND completed_at < ${window.until}
  `;

  const threadSelect = sql`
    SELECT
      t.thread_id AS "threadId",
      t.project_id AS "projectId",
      p.title AS "projectTitle",
      t.title,
      t.branch,
      t.worktree_path AS "worktreePath",
      COALESCE(
        json_extract(t.model_selection_json, '$.instanceId'),
        json_extract(t.model_selection_json, '$.provider'),
        s.provider_instance_id,
        s.provider_name
      ) AS provider,
      s.provider_name AS "providerName",
      json_extract(t.model_selection_json, '$.model') AS model,
      t.runtime_mode AS "runtimeMode",
      t.interaction_mode AS "interactionMode",
      t.created_at AS "createdAt",
      ${lastActivitySql} AS "lastActivityAt",
      t.archived_at AS "archivedAt",
      t.settled_at AS "settledAt",
      t.settled_override AS "settledOverride",
      t.pinned_at AS "pinnedAt",
      t.snoozed_until AS "snoozedUntil",
      s.status AS "sessionStatus",
      (SELECT COUNT(*) FROM projection_turns AS tu WHERE tu.thread_id = t.thread_id) AS "turnCount",
      t.pending_approval_count AS "pendingApprovalCount",
      t.pending_user_input_count AS "pendingUserInputCount",
      t.has_actionable_proposed_plan AS "hasActionableProposedPlan",
      tabs.group_id AS "tabGroupId",
      json_extract(t.created_by_json, '$.threadId') AS "startedByThreadId"
    FROM projection_threads AS t
    JOIN projection_projects AS p ON p.project_id = t.project_id
    LEFT JOIN projection_thread_sessions AS s ON s.thread_id = t.thread_id
    LEFT JOIN fork_thread_tabs AS tabs ON tabs.thread_id = t.thread_id
  `;

  const threadConditions = (filter: ThreadFilter): Fragment =>
    sql.and([
      liveThreads,
      ...(filter.threadId === undefined ? [] : [sql`t.thread_id = ${filter.threadId}`]),
      ...(filter.projectId === undefined ? [] : [sql`t.project_id = ${filter.projectId}`]),
      ...(filter.archived === "only"
        ? [sql`t.archived_at IS NOT NULL`]
        : filter.archived === "include"
          ? []
          : [sql`t.archived_at IS NULL`]),
      ...(filter.needsAttention === undefined
        ? []
        : [
            filter.needsAttention
              ? sql`(t.pending_approval_count > 0 OR t.pending_user_input_count > 0 OR t.has_actionable_proposed_plan = 1)`
              : sql`(t.pending_approval_count = 0 AND t.pending_user_input_count = 0 AND t.has_actionable_proposed_plan = 0)`,
          ]),
      ...(filter.hasPullRequest === undefined
        ? []
        : [
            sql`${filter.hasPullRequest ? sql`` : sql`NOT`} EXISTS (
              SELECT 1 FROM projection_thread_pull_requests AS pr
              WHERE pr.thread_id = t.thread_id AND pr.source != 'stack-dismissed'
            )`,
          ]),
      ...(filter.branch === undefined ? [] : [sql`t.branch = ${filter.branch}`]),
      ...(filter.titleContains === undefined
        ? []
        : [sql`t.title LIKE ${likePattern(filter.titleContains)} ESCAPE '!'`]),
    ]);

  const pullRequestBriefs = Effect.fn("QueryStore.pullRequestBriefs")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const rows = yield* sql<{
      readonly threadId: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly url: string;
      readonly snapshotJson: string | null;
    }>`
      SELECT thread_id AS "threadId", host, repository, number, url, snapshot_json AS "snapshotJson"
      FROM projection_thread_pull_requests
      WHERE ${idsIn("thread_id", threadIds)} AND source != 'stack-dismissed'
      ORDER BY linked_at DESC
    `;
    const byThread = new Map<string, Array<PullRequestBrief>>();
    for (const row of rows) {
      const { snapshot: _snapshot, ...brief } = pullRequestOf(row);
      byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), brief]);
    }
    return byThread;
  });

  const windowStats = Effect.fn("QueryStore.windowStats")(function* (
    threadIds: ReadonlyArray<string>,
    window: Window,
  ) {
    const prompts = yield* sql<{ readonly threadId: string; readonly count: number }>`
      SELECT thread_id AS "threadId", COUNT(*) AS count FROM projection_thread_messages
      WHERE ${idsIn("thread_id", threadIds)} AND role = 'user'
        AND created_at >= ${window.since} AND created_at < ${window.until}
      GROUP BY thread_id
    `;
    const turns = yield* sql<{ readonly threadId: string; readonly filesJson: string | null }>`
      SELECT thread_id AS "threadId", checkpoint_files_json AS "filesJson" FROM projection_turns
      WHERE ${idsIn("thread_id", threadIds)}
        AND completed_at >= ${window.since} AND completed_at < ${window.until}
      ORDER BY completed_at ASC
    `;
    const promptCounts = new Map(prompts.map((row) => [row.threadId, row.count]));
    const turnFiles = new Map<string, Array<ReadonlyArray<OrchestrationCheckpointFile>>>();
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
        additions: files.reduce((total, file) => total + file.additions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
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
        ...(filter.provider === undefined
          ? []
          : [
              sql`(base.provider = ${filter.provider} OR base."providerName" = ${filter.provider})`,
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
      (row): ThreadSummary => ({
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
        startedByThreadId: row.startedByThreadId,
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
      }),
    );
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
      readonly activeTurnId: string | null;
      readonly lastError: string | null;
      readonly updatedAt: string;
    }>`
      SELECT status, COALESCE(provider_instance_id, provider_name) AS provider,
        active_turn_id AS "activeTurnId", last_error AS "lastError", updated_at AS "updatedAt"
      FROM projection_thread_sessions WHERE thread_id = ${threadId}
    `;
    const messageCounts = yield* sql<{ readonly role: string; readonly count: number }>`
      SELECT role, COUNT(*) AS count FROM projection_thread_messages
      WHERE thread_id = ${threadId} GROUP BY role
    `;
    const activityCounts = yield* sql<{ readonly tone: string; readonly count: number }>`
      SELECT tone, COUNT(*) AS count FROM projection_thread_activities
      WHERE thread_id = ${threadId} GROUP BY tone
    `;
    const firstPrompt = yield* sql<{ readonly text: string }>`
      SELECT substr(text, 1, 2001) AS text FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND role = 'user'
      ORDER BY created_at ASC, message_id ASC LIMIT 1
    `;
    const latestResponse = yield* sql<{ readonly text: string }>`
      SELECT substr(text, 1, 2001) AS text FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND role = 'assistant'
      ORDER BY created_at DESC, message_id DESC LIMIT 1
    `;
    const pendingApprovals = yield* sql<{
      readonly requestId: string;
      readonly turnId: string | null;
      readonly createdAt: string;
    }>`
      SELECT request_id AS "requestId", turn_id AS "turnId", created_at AS "createdAt"
      FROM projection_pending_approvals WHERE thread_id = ${threadId} AND status = 'pending'
      ORDER BY created_at ASC
    `;
    const plans = yield* listPlans({ threadId }, { order: "desc", limit: 20, after: null });
    const tabs = yield* sql<{
      readonly threadId: string;
      readonly title: string;
      readonly position: number;
    }>`
      SELECT tabs.thread_id AS "threadId", t.title, tabs.position
      FROM fork_thread_tabs AS tabs
      JOIN projection_threads AS t ON t.thread_id = tabs.thread_id
      WHERE tabs.group_id = (SELECT group_id FROM fork_thread_tabs WHERE thread_id = ${threadId})
        AND t.deleted_at IS NULL
      ORDER BY tabs.position ASC, tabs.created_at ASC
    `;
    const turns = yield* sql<{ readonly filesJson: string | null }>`
      SELECT checkpoint_files_json AS "filesJson" FROM projection_turns
      WHERE thread_id = ${threadId} ORDER BY requested_at ASC, row_id ASC
    `;
    const changedFiles = mergeFiles(turns.map((row) => parseFiles(row.filesJson)));
    const session = sessions[0];
    return {
      thread,
      session: session ?? null,
      counts: {
        messagesByRole: Object.fromEntries(messageCounts.map((row) => [row.role, row.count])),
        activitiesByTone: Object.fromEntries(activityCounts.map((row) => [row.tone, row.count])),
      },
      firstPrompt: cut(firstPrompt[0]?.text ?? null, 2000).text,
      latestResponse: cut(latestResponse[0]?.text ?? null, 2000).text,
      pendingApprovals,
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
      LEFT JOIN projection_threads AS t ON t.project_id = p.project_id AND t.deleted_at IS NULL
      WHERE ${sql.and([
        sql`p.deleted_at IS NULL`,
        ...(input.projectId === undefined ? [] : [sql`p.project_id = ${input.projectId}`]),
        ...(input.window === undefined
          ? []
          : [
              sql`p.project_id IN (
                SELECT active.project_id FROM projection_threads AS active
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
        (SELECT COUNT(*) FROM projection_threads AS t
          JOIN projection_projects AS p ON p.project_id = t.project_id
          WHERE ${liveThreads} AND t.archived_at IS NULL) AS threads,
        (SELECT COUNT(*) FROM projection_threads AS t
          JOIN projection_projects AS p ON p.project_id = t.project_id
          WHERE ${liveThreads} AND t.archived_at IS NOT NULL) AS "archivedThreads"
    `;
    return rows[0] ?? { projects: 0, threads: 0, archivedThreads: 0 };
  });

  const detailSql = sql`substr(CASE WHEN json_valid(a.payload_json) THEN COALESCE(
    json_extract(a.payload_json, '$.detail'),
    json_extract(a.payload_json, '$.message'),
    json_extract(a.payload_json, '$.prompt'),
    json_extract(a.payload_json, '$.title')
  ) END, 1, ${DETAIL_CHARS})`;

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
    const rows = yield* sql<Omit<TimelineEntry, "kind"> & { readonly kind: TimelineKind }>`
      WITH feed AS (
        SELECT t.created_at AS at, 'thread.created' AS kind, t.thread_id AS id,
          t.thread_id AS thread_id, NULL AS turn_id, t.title AS summary
        FROM projection_threads AS t WHERE t.created_at >= ${since} AND t.created_at < ${until}
        UNION ALL
        SELECT m.created_at, 'prompt', m.message_id, m.thread_id, NULL,
          substr(m.text, 1, ${TIMELINE_PROMPT_CHARS})
        FROM projection_thread_messages AS m
        WHERE m.role = 'user' AND m.created_at >= ${since} AND m.created_at < ${until}
        UNION ALL
        SELECT tu.completed_at, 'turn.completed', tu.turn_id, tu.thread_id, tu.turn_id,
          tu.state || ' · ' || json_array_length(tu.checkpoint_files_json) || ' files +'
            || (SELECT COALESCE(SUM(json_extract(value, '$.additions')), 0) FROM json_each(tu.checkpoint_files_json))
            || ' -'
            || (SELECT COALESCE(SUM(json_extract(value, '$.deletions')), 0) FROM json_each(tu.checkpoint_files_json))
            || COALESCE(' · ' || substr(reply.text, 1, ${TIMELINE_SUMMARY_CHARS}), '')
        FROM projection_turns AS tu
        LEFT JOIN projection_thread_messages AS reply ON reply.message_id = tu.assistant_message_id
        WHERE tu.turn_id IS NOT NULL AND json_valid(tu.checkpoint_files_json)
          AND tu.completed_at >= ${since} AND tu.completed_at < ${until}
        UNION ALL
        SELECT pl.created_at, 'plan.proposed', pl.plan_id, pl.thread_id, pl.turn_id,
          substr(pl.plan_markdown, 1, ${TIMELINE_SUMMARY_CHARS})
        FROM projection_thread_proposed_plans AS pl
        WHERE pl.created_at >= ${since} AND pl.created_at < ${until}
        UNION ALL
        SELECT pl.implemented_at, 'plan.implemented', pl.plan_id, pl.thread_id, pl.turn_id,
          substr(pl.plan_markdown, 1, ${TIMELINE_SUMMARY_CHARS})
        FROM projection_thread_proposed_plans AS pl
        WHERE pl.implemented_at >= ${since} AND pl.implemented_at < ${until}
        UNION ALL
        SELECT pr.linked_at, 'pull_request.linked', pr.url, pr.thread_id, NULL,
          pr.repository || '#' || pr.number || COALESCE(' ' || json_extract(
            CASE WHEN json_valid(pr.snapshot_json) THEN pr.snapshot_json END, '$.title'), '')
        FROM projection_thread_pull_requests AS pr
        WHERE pr.source != 'stack-dismissed' AND pr.linked_at >= ${since} AND pr.linked_at < ${until}
        UNION ALL
        SELECT ap.created_at, 'approval.requested', ap.request_id, ap.thread_id, ap.turn_id,
          'Approval requested' || COALESCE(' · ' || ap.decision, '')
        FROM projection_pending_approvals AS ap
        WHERE ap.created_at >= ${since} AND ap.created_at < ${until}
        UNION ALL
        SELECT a.created_at, 'error', a.activity_id, a.thread_id, a.turn_id,
          a.summary || COALESCE(': ' || ${detailSql}, '')
        FROM projection_thread_activities AS a
        WHERE a.tone = 'error' AND a.created_at >= ${since} AND a.created_at < ${until}
        UNION ALL
        SELECT t.archived_at, 'thread.archived', t.thread_id, t.thread_id, NULL, t.title
        FROM projection_threads AS t WHERE t.archived_at >= ${since} AND t.archived_at < ${until}
        UNION ALL
        SELECT t.settled_at, 'thread.settled', t.thread_id, t.thread_id, NULL, t.title
        FROM projection_threads AS t
        WHERE t.settled_override IS NOT 'active'
          AND t.settled_at >= ${since} AND t.settled_at < ${until}
      )
      SELECT feed.at, feed.kind, feed.id, feed.thread_id AS "threadId", t.title AS "threadTitle",
        t.project_id AS "projectId", p.title AS "projectTitle", feed.turn_id AS "turnId",
        COALESCE(feed.summary, '') AS summary
      FROM feed
      JOIN projection_threads AS t ON t.thread_id = feed.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE ${sql.and([
        liveThreads,
        ...(input.projectId === undefined ? [] : [sql`t.project_id = ${input.projectId}`]),
        ...(input.threadId === undefined ? [] : [sql`feed.thread_id = ${input.threadId}`]),
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
      (row): TimelineEntry => ({ ...row, summary: row.summary.replace(/\s+/g, " ").trim() }),
    );
  });

  interface TurnRow {
    readonly rowId: number;
    readonly turnId: string;
    readonly threadId: string;
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
    SELECT tu.row_id AS "rowId", tu.turn_id AS "turnId", tu.thread_id AS "threadId",
      tu.checkpoint_turn_count AS "turnCount", tu.state, tu.requested_at AS "requestedAt",
      tu.started_at AS "startedAt", tu.completed_at AS "completedAt",
      substr(prompt.text, 1, ${maxChars + 1}) AS prompt,
      substr(reply.text, 1, ${maxChars + 1}) AS response,
      tu.checkpoint_files_json AS "filesJson", tu.source_proposed_plan_id AS "sourcePlanId"
    FROM projection_turns AS tu
    LEFT JOIN projection_thread_messages AS prompt ON prompt.message_id = tu.pending_message_id
    LEFT JOIN projection_thread_messages AS reply ON reply.message_id = tu.assistant_message_id
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
        additions: files.reduce((total, file) => total + file.additions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
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
        sql`tu.thread_id = ${input.threadId}`,
        sql`tu.turn_id IS NOT NULL`,
        sql`tu.requested_at >= ${input.window.since}`,
        sql`tu.requested_at < ${input.window.until}`,
        after(sql`tu.requested_at, tu.row_id`, page),
      ])}
      ORDER BY tu.requested_at ${direction(page.order)}, tu.row_id ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(rows, page, (row) => [row.requestedAt, row.rowId], turnSummaryOf(input.maxChars));
  });

  const activitySelect = sql`
    SELECT a.activity_id AS "activityId", a.thread_id AS "threadId", a.turn_id AS "turnId",
      a.tone, a.kind, a.summary, ${detailSql} AS detail, a.created_at AS "createdAt"
    FROM projection_thread_activities AS a
  `;

  const getTurn = Effect.fn("QueryStore.getTurn")(function* (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly maxChars: number;
  }) {
    const rows = yield* sql<TurnRow>`
      ${turnSelect(input.maxChars)}
      WHERE tu.thread_id = ${input.threadId} AND tu.turn_id = ${input.turnId}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const counts = yield* sql<{ readonly kind: string; readonly count: number }>`
      SELECT kind, COUNT(*) AS count FROM projection_thread_activities
      WHERE thread_id = ${input.threadId} AND turn_id = ${input.turnId} GROUP BY kind
    `;
    const notable = yield* sql<ActivityEntry>`
      ${activitySelect}
      WHERE a.thread_id = ${input.threadId} AND a.turn_id = ${input.turnId}
        AND (a.tone = 'error' OR a.kind IN (
          'tool.completed', 'task.started', 'task.completed', 'turn.plan.updated',
          'user-input.requested', 'runtime.error', 'runtime.warning'
        ))
      ORDER BY a.created_at DESC, a.activity_id DESC LIMIT 40
    `;
    return {
      turn: turnSummaryOf(input.maxChars)(row),
      activityCounts: Object.fromEntries(counts.map((count) => [count.kind, count.count])),
      notableActivities: notable.toReversed(),
    };
  });

  const turnCountOf = Effect.fn("QueryStore.turnCountOf")(function* (
    threadId: string,
    turnId: string,
  ) {
    const rows = yield* sql<{ readonly turnCount: number | null }>`
      SELECT checkpoint_turn_count AS "turnCount" FROM projection_turns
      WHERE thread_id = ${threadId} AND turn_id = ${turnId}
    `;
    return rows[0];
  });

  const filesBetween = Effect.fn("QueryStore.filesBetween")(function* (input: {
    readonly threadId: string;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  }) {
    const rows = yield* sql<{ readonly filesJson: string | null }>`
      SELECT checkpoint_files_json AS "filesJson" FROM projection_turns
      WHERE thread_id = ${input.threadId}
        AND checkpoint_turn_count > ${input.fromTurnCount}
        AND checkpoint_turn_count <= ${input.toTurnCount}
      ORDER BY checkpoint_turn_count ASC
    `;
    return mergeFiles(rows.map((row) => parseFiles(row.filesJson)));
  });

  const threadExists = Effect.fn("QueryStore.threadExists")(function* (threadId: string) {
    const rows = yield* sql<{ readonly found: number }>`
      SELECT 1 AS found FROM projection_threads AS t
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE t.thread_id = ${threadId} AND ${liveThreads}
    `;
    return rows.length > 0;
  });

  interface MessageRow {
    readonly messageId: string;
    readonly threadId: string;
    readonly threadTitle: string;
    readonly turnId: string | null;
    readonly role: string;
    readonly createdAt: string;
    readonly isStreaming: number;
    readonly text: string;
    readonly attachmentCount: number;
    readonly attachmentsJson: string | null;
    readonly contextJson: string | null;
  }

  const messageSelect = (maxChars: number) => sql`
    SELECT m.message_id AS "messageId", m.thread_id AS "threadId", t.title AS "threadTitle",
      m.turn_id AS "turnId", m.role, m.created_at AS "createdAt", m.is_streaming AS "isStreaming",
      substr(m.text, 1, ${maxChars + 1}) AS text,
      CASE WHEN json_valid(m.attachments_json) THEN json_array_length(m.attachments_json) ELSE 0 END
        AS "attachmentCount",
      m.attachments_json AS "attachmentsJson", m.context_json AS "contextJson"
    FROM projection_thread_messages AS m
    JOIN projection_threads AS t ON t.thread_id = m.thread_id
    JOIN projection_projects AS p ON p.project_id = t.project_id
  `;

  const messageEntryOf =
    (maxChars: number) =>
    (row: MessageRow): MessageEntry => {
      const text = cut(row.text, maxChars);
      return {
        messageId: row.messageId,
        threadId: row.threadId,
        threadTitle: row.threadTitle,
        turnId: row.turnId,
        role: row.role,
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
    const rows = yield* sql<MessageRow>`
      ${messageSelect(input.maxChars)}
      WHERE ${sql.and([
        liveThreads,
        roleCondition(input.role, input.includeReasoning),
        ...(input.threadId === undefined ? [] : [sql`m.thread_id = ${input.threadId}`]),
        ...(input.projectId === undefined ? [] : [sql`t.project_id = ${input.projectId}`]),
        sql`m.created_at >= ${input.window.since}`,
        sql`m.created_at < ${input.window.until}`,
        after(sql`m.created_at, m.message_id`, page),
      ])}
      ORDER BY m.created_at ${direction(page.order)}, m.message_id ${direction(page.order)}
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
      ${messageSelect(maxChars)} WHERE m.message_id = ${messageId} AND ${liveThreads}
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
    const scope = [
      liveThreads,
      ...(input.projectId === undefined ? [] : [sql`t.project_id = ${input.projectId}`]),
      ...(input.threadId === undefined ? [] : [sql`t.thread_id = ${input.threadId}`]),
    ];
    const threads = yield* sql<{
      readonly threadId: string;
      readonly title: string;
      readonly projectTitle: string;
      readonly lastActivityAt: string;
    }>`
      SELECT t.thread_id AS "threadId", t.title, p.title AS "projectTitle",
        ${lastActivitySql} AS "lastActivityAt"
      FROM projection_threads AS t
      JOIN projection_projects AS p ON p.project_id = t.project_id
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
      FROM projection_thread_messages AS m
      JOIN projection_threads AS t ON t.thread_id = m.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE ${sql.and([
        ...scope,
        input.role === "any" ? sql`m.role IN ('user', 'assistant')` : sql`m.role = ${input.role}`,
        sql`m.created_at >= ${input.window.since}`,
        sql`m.created_at < ${input.window.until}`,
        sql`m.text LIKE ${pattern} ESCAPE '!'`,
      ])}
      ORDER BY m.created_at DESC, m.message_id DESC LIMIT ${input.limit}
    `;
    return {
      threads,
      messages: messages.map((message) => ({
        ...message,
        snippet: message.snippet.replace(/\s+/g, " ").trim(),
      })),
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
    const rows = yield* sql<ActivityEntry>`
      ${activitySelect}
      JOIN projection_threads AS t ON t.thread_id = a.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE ${sql.and([
        liveThreads,
        ...(input.threadId === undefined ? [] : [sql`a.thread_id = ${input.threadId}`]),
        ...(input.turnId === undefined ? [] : [sql`a.turn_id = ${input.turnId}`]),
        ...(input.projectId === undefined ? [] : [sql`t.project_id = ${input.projectId}`]),
        ...(input.tone === undefined ? [] : [sql`a.tone = ${input.tone}`]),
        ...(input.kinds === undefined || input.kinds.length === 0
          ? []
          : [sql.in("a.kind", input.kinds)]),
        sql`a.created_at >= ${input.window.since}`,
        sql`a.created_at < ${input.window.until}`,
        after(sql`a.created_at, a.activity_id`, page),
      ])}
      ORDER BY a.created_at ${direction(page.order)}, a.activity_id ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(
      rows,
      page,
      (row) => [row.createdAt, row.activityId],
      (row) => row,
    );
  });

  const getActivity = Effect.fn("QueryStore.getActivity")(function* (
    activityId: string,
    maxChars: number,
  ) {
    const rows = yield* sql<
      ActivityEntry & { readonly payload: string; readonly payloadLength: number }
    >`
      SELECT a.activity_id AS "activityId", a.thread_id AS "threadId", a.turn_id AS "turnId",
        a.tone, a.kind, a.summary, ${detailSql} AS detail, a.created_at AS "createdAt",
        substr(a.payload_json, 1, ${maxChars}) AS payload, length(a.payload_json) AS "payloadLength"
      FROM projection_thread_activities AS a
      JOIN projection_threads AS t ON t.thread_id = a.thread_id
      JOIN projection_projects AS p ON p.project_id = t.project_id
      WHERE a.activity_id = ${activityId} AND ${liveThreads}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const { payload, payloadLength, ...activity } = row;
    const truncated = payloadLength > maxChars;
    return {
      activity,
      payload: truncated ? `${payload}…` : parseJson(payload),
      truncated,
    };
  });

  interface PlanRow {
    readonly planId: string;
    readonly threadId: string;
    readonly threadTitle: string;
    readonly turnId: string | null;
    readonly markdown: string;
    readonly markdownLength: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly implementedAt: string | null;
    readonly implementationThreadId: string | null;
  }

  const planSelect = (maxChars: number) => sql`
    SELECT pl.plan_id AS "planId", pl.thread_id AS "threadId", t.title AS "threadTitle",
      pl.turn_id AS "turnId", substr(pl.plan_markdown, 1, ${maxChars}) AS markdown,
      length(pl.plan_markdown) AS "markdownLength", pl.created_at AS "createdAt",
      pl.updated_at AS "updatedAt", pl.implemented_at AS "implementedAt",
      pl.implementation_thread_id AS "implementationThreadId"
    FROM projection_thread_proposed_plans AS pl
    JOIN projection_threads AS t ON t.thread_id = pl.thread_id
    JOIN projection_projects AS p ON p.project_id = t.project_id
  `;

  const planEntryOf = (row: PlanRow): PlanEntry => ({
    planId: row.planId,
    threadId: row.threadId,
    threadTitle: row.threadTitle,
    turnId: row.turnId,
    title: planTitle(row.markdown),
    preview: cut(row.markdown, 300).text ?? "",
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
      ${planSelect(600)}
      WHERE ${sql.and([
        liveThreads,
        ...(input.threadId === undefined ? [] : [sql`pl.thread_id = ${input.threadId}`]),
        ...(input.projectId === undefined ? [] : [sql`t.project_id = ${input.projectId}`]),
        ...(input.implemented === undefined
          ? []
          : [
              input.implemented
                ? sql`pl.implemented_at IS NOT NULL`
                : sql`pl.implemented_at IS NULL`,
            ]),
        sql`pl.created_at >= ${window.since}`,
        sql`pl.created_at < ${window.until}`,
        after(sql`pl.created_at, pl.plan_id`, page),
      ])}
      ORDER BY pl.created_at ${direction(page.order)}, pl.plan_id ${direction(page.order)}
      LIMIT ${page.limit + 1}
    `;
    return pageOf(rows, page, (row) => [row.createdAt, row.planId], planEntryOf);
  });

  const getPlan = Effect.fn("QueryStore.getPlan")(function* (planId: string, maxChars: number) {
    const rows = yield* sql<PlanRow>`
      ${planSelect(maxChars)} WHERE pl.plan_id = ${planId} AND ${liveThreads}
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const truncated = row.markdownLength > maxChars;
    return {
      plan: planEntryOf(row),
      markdown: truncated ? `${row.markdown}…` : row.markdown,
      truncated,
    };
  });

  const pullRequestSelect = sql`
    SELECT pr.host, pr.repository, pr.number, pr.url, pr.source, pr.linked_at AS "linkedAt",
      pr.snapshot_json AS "snapshotJson", pr.thread_id AS "threadId", t.title AS "threadTitle",
      t.project_id AS "projectId"
    FROM projection_thread_pull_requests AS pr
    JOIN projection_threads AS t ON t.thread_id = pr.thread_id
    JOIN projection_projects AS p ON p.project_id = t.project_id
  `;

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
      ${pullRequestSelect}
      WHERE ${sql.and([
        liveThreads,
        sql`pr.source != 'stack-dismissed'`,
        ...(input.threadId === undefined ? [] : [sql`pr.thread_id = ${input.threadId}`]),
        ...(input.projectId === undefined ? [] : [sql`t.project_id = ${input.projectId}`]),
        ...(input.state === undefined
          ? []
          : [
              sql`json_extract(CASE WHEN json_valid(pr.snapshot_json) THEN pr.snapshot_json END, '$.state') = ${input.state}`,
            ]),
        sql`pr.linked_at >= ${window.since}`,
        sql`pr.linked_at < ${window.until}`,
        after(sql`pr.linked_at, pr.thread_id, pr.url`, page),
      ])}
      ORDER BY pr.linked_at ${direction(page.order)}, pr.thread_id ${direction(page.order)},
        pr.url ${direction(page.order)}
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
      ${pullRequestSelect}
      WHERE ${liveThreads} AND pr.source != 'stack-dismissed'
        AND lower(pr.repository) = ${key.repository.toLowerCase()} AND pr.number = ${key.number}
      ORDER BY pr.linked_at ASC
    `;
    const host = key.host;
    return rows
      .filter(
        (row) =>
          host === null ||
          threadPullRequestKeysEqual(row, { host, repository: key.repository, number: key.number }),
      )
      .map(pullRequestEntryOf);
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
    listPlans,
    getPlan,
    listPullRequests,
    getPullRequest,
  };
});

export type QueryStore = Effect.Success<typeof makeQueryStore>;
