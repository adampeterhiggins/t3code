import {
  CommandId,
  ThreadId,
  type CreateThreadTabInput,
  type ForkThreadTabInput,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  type ThreadTabGroup,
  type ThreadTabHandoff,
  type ThreadTabHandoffInput,
  type ThreadTabMemberships,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { GitHubIssueThreadLinks } from "../githubIssues/GitHubIssueThreadLinks.ts";
import { LinearThreadLinks } from "../linear/LinearThreadLinks.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { THREAD_HISTORY_SNAPSHOT_ROW_LIMIT } from "../orchestration-v2/threadHistoryPaging.ts";
import {
  siblingChatBeforeMessage,
  siblingChatThroughMessage,
  summarizeSiblingChat,
} from "./summary.ts";

export class ThreadTabsError extends Schema.TaggedError<ThreadTabsError>()("ThreadTabsError", {
  reason: Schema.Literals(["thread_not_found", "invalid_request", "dispatch_failed", "internal"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Recent user turns a whole-chat handoff summarizes; forks read the full history to their cut. */
const HANDOFF_USER_TURN_LIMIT = 8;

/**
 * Chat tabs: threads grouped in the fork-owned `fork_thread_tabs` table so they share one
 * workspace and show as one sidebar row. Each tab is an ordinary orchestration thread.
 */
export class ThreadTabs extends Context.Service<
  ThreadTabs,
  {
    /** Every membership in the environment, in group and position order. */
    readonly memberships: Effect.Effect<ThreadTabMemberships, ThreadTabsError>;
    /** The group `threadId` belongs to; a thread without tabs is a group of one. */
    readonly group: (threadId: ThreadId) => Effect.Effect<ThreadTabGroup, ThreadTabsError>;
    /** Adds an empty tab to `sourceThreadId`'s group, on the source's branch and worktree. */
    readonly create: (
      sourceThreadId: ThreadId,
      input: CreateThreadTabInput,
    ) => Effect.Effect<ThreadTabGroup, ThreadTabsError>;
    /**
     * Groups threads that do not exist yet as tabs, in order, under the first. Call it before
     * writing the threads so clients never see them as standalone rows.
     */
    readonly adopt: (threadIds: ReadonlyArray<ThreadId>) => Effect.Effect<void, ThreadTabsError>;
    /** Forks a completed response with the native `thread.fork` into a new tab of the group. */
    readonly fork: (
      threadId: ThreadId,
      input: ForkThreadTabInput,
    ) => Effect.Effect<ThreadTabGroup, ThreadTabsError>;
    /** Summaries of other chats for `threadId`, which may still be a draft. */
    readonly handoff: (
      threadId: ThreadId,
      input: ThreadTabHandoffInput,
    ) => Effect.Effect<ThreadTabHandoff, ThreadTabsError>;
  }
>()("t3/threadTabs/ThreadTabs") {}

interface TabRow {
  readonly threadId: string;
  readonly groupId: string;
  readonly position: number;
}

const internal = (detail: string) => (cause: unknown) =>
  new ThreadTabsError({ reason: "internal", detail, cause });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagementService;
  const linearThreadLinks = yield* LinearThreadLinks;
  const githubIssueThreadLinks = yield* GitHubIssueThreadLinks;
  const crypto = yield* Crypto.Crypto;

  const shellOf = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(Effect.mapError(internal("Could not read the thread.")));

  const requireShell = Effect.fn("ThreadTabs.requireShell")(function* (threadId: ThreadId) {
    const shell = yield* shellOf(threadId);
    if (shell === null || shell.deletedAt !== null) {
      return yield* new ThreadTabsError({
        reason: "thread_not_found",
        detail: `Thread ${threadId} was not found.`,
      });
    }
    return shell;
  });

  const tabOf = (thread: OrchestrationV2ThreadShell) => ({
    threadId: thread.id,
    title: thread.title.trim() || "New tab",
    modelSelection: thread.modelSelection,
  });

  const group: ThreadTabs["Service"]["group"] = Effect.fn("ThreadTabs.group")(function* (threadId) {
    const source = yield* requireShell(threadId);
    const membership = yield* sql<TabRow>`
      SELECT thread_id AS "threadId", group_id AS "groupId", position
      FROM fork_thread_tabs WHERE thread_id = ${threadId}
    `.pipe(Effect.mapError(internal("Could not read tab membership.")));
    const groupId = ThreadId.make(membership[0]?.groupId ?? threadId);
    const rows = yield* sql<TabRow>`
      SELECT thread_id AS "threadId", group_id AS "groupId", position
      FROM fork_thread_tabs WHERE group_id = ${groupId} ORDER BY position, created_at
    `.pipe(Effect.mapError(internal("Could not read tab membership.")));
    const siblings =
      rows.length === 0
        ? [source]
        : yield* Effect.forEach(rows, (row) => shellOf(ThreadId.make(row.threadId)), {
            concurrency: 8,
          });
    return {
      groupId,
      tabs: siblings
        .filter((thread) => thread !== null && thread.deletedAt === null)
        .map((thread) => tabOf(thread!)),
    };
  });

  /**
   * Writes the new tab's membership, then dispatches the command that creates its thread.
   * Membership comes first so clients that refetch memberships on the new shell never see it
   * as a standalone thread; a rejected command removes it again.
   */
  const addTab = Effect.fn("ThreadTabs.addTab")(function* (
    source: OrchestrationV2ThreadShell,
    tabThreadId: ThreadId,
    command: OrchestrationV2ServerCommand,
  ) {
    if ((yield* shellOf(tabThreadId)) !== null) {
      return yield* new ThreadTabsError({
        reason: "invalid_request",
        detail: `Thread ${tabThreadId} already exists.`,
      });
    }
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* sql<TabRow>`
            SELECT thread_id AS "threadId", group_id AS "groupId", position
            FROM fork_thread_tabs WHERE thread_id = ${source.id}
          `;
          const groupId = existing[0]?.groupId ?? source.id;
          yield* sql`
            INSERT OR IGNORE INTO fork_thread_tabs (thread_id, group_id, position, created_at)
            VALUES (${source.id}, ${groupId}, 0, ${DateTime.formatIso(source.createdAt)})
          `;
          const max = yield* sql<{ readonly position: number }>`
            SELECT COALESCE(MAX(position), 0) AS position FROM fork_thread_tabs
            WHERE group_id = ${groupId}
          `;
          yield* sql`
            INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at)
            VALUES (${tabThreadId}, ${groupId}, ${(max[0]?.position ?? 0) + 1}, ${createdAt})
          `;
        }),
      )
      .pipe(Effect.mapError(internal("Could not save tab membership.")));
    // The group's issue links, if any, now cover the new tab too.
    yield* linearThreadLinks.refresh;
    yield* githubIssueThreadLinks.refresh;

    yield* threads.dispatch(command).pipe(
      Effect.tapError(() =>
        sql`DELETE FROM fork_thread_tabs WHERE thread_id = ${tabThreadId}`.pipe(
          Effect.andThen(linearThreadLinks.refresh),
          Effect.andThen(githubIssueThreadLinks.refresh),
          Effect.ignore,
        ),
      ),
      Effect.mapError(
        (cause) =>
          new ThreadTabsError({
            reason: "dispatch_failed",
            detail: `Could not create tab ${tabThreadId}.`,
            cause,
          }),
      ),
    );
    return yield* group(tabThreadId);
  });

  const adopt: ThreadTabs["Service"]["adopt"] = Effect.fn("ThreadTabs.adopt")(
    function* (threadIds) {
      const groupId = threadIds[0];
      if (groupId === undefined || threadIds.length < 2) return;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql
        .withTransaction(
          Effect.forEach(
            threadIds,
            (threadId, position) => sql`
            INSERT OR IGNORE INTO fork_thread_tabs (thread_id, group_id, position, created_at)
            VALUES (${threadId}, ${groupId}, ${position}, ${createdAt})
          `,
            { discard: true },
          ),
        )
        .pipe(Effect.mapError(internal("Could not save tab membership.")));
      yield* linearThreadLinks.refresh;
      yield* githubIssueThreadLinks.refresh;
    },
  );

  const newCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)),
      Effect.mapError(internal("Could not allocate a command id.")),
    );

  const create: ThreadTabs["Service"]["create"] = Effect.fn("ThreadTabs.create")(
    function* (sourceThreadId, input) {
      const source = yield* requireShell(sourceThreadId);
      return yield* addTab(source, input.threadId, {
        type: "thread.create",
        commandId: yield* newCommandId("thread-tab-create"),
        createdBy: "user",
        creationSource: input.creationSource ?? "web",
        threadId: input.threadId,
        projectId: source.projectId,
        title: "New tab",
        modelSelection: input.modelSelection,
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
        branch: source.branch,
        worktreePath: source.worktreePath,
      });
    },
  );

  const fork: ThreadTabs["Service"]["fork"] = Effect.fn("ThreadTabs.fork")(
    function* (threadId, input) {
      const tab = yield* requireShell(threadId);
      // The fork copies its source's branch and worktree, which a sibling tab already shares.
      yield* requireShell(input.sourceThreadId);
      return yield* addTab(tab, input.threadId, {
        type: "thread.fork",
        commandId: yield* newCommandId("thread-tab-fork"),
        createdBy: "user",
        creationSource: input.creationSource ?? "web",
        sourceThreadId: input.sourceThreadId,
        targetThreadId: input.threadId,
        sourcePoint: { type: "run", runId: input.runId },
        ...(input.title === undefined ? {} : { title: input.title }),
      });
    },
  );

  const summarize = Effect.fn("ThreadTabs.summarize")(function* (
    sourceId: ThreadId,
    cut: Pick<ThreadTabHandoffInput, "beforeMessageId" | "afterMessageId">,
  ) {
    const shell = yield* shellOf(sourceId);
    if (shell === null || shell.deletedAt !== null) {
      return yield* new ThreadTabsError({
        reason: "invalid_request",
        detail: `Thread ${sourceId} was not found.`,
      });
    }
    // A fork cuts the history at its message, which may be older than the recent window.
    const { projection, snapshotSequence } = yield* (
      cut.beforeMessageId === undefined && cut.afterMessageId === undefined
        ? threads.getThreadSnapshotWindow(sourceId, {
            rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
            userTurnLimit: HANDOFF_USER_TURN_LIMIT,
          })
        : threads.getThreadSnapshot(sourceId)
    ).pipe(Effect.mapError(internal(`Could not read thread ${sourceId}.`)));
    const chat = {
      title: shell.title,
      worktreePath: shell.worktreePath,
      latestRunStatus: projection.runs.at(-1)?.status ?? null,
      items: projection.visibleTurnItems.map((projected) => projected.item),
    };
    const source =
      cut.afterMessageId !== undefined
        ? siblingChatThroughMessage(chat, cut.afterMessageId)
        : cut.beforeMessageId !== undefined
          ? siblingChatBeforeMessage(chat, cut.beforeMessageId)
          : chat;
    if (source === null) {
      return yield* new ThreadTabsError({
        reason: "invalid_request",
        detail: "The fork point is not a message of that chat.",
      });
    }
    return `Source thread: ${sourceId} (snapshot ${snapshotSequence})\n${summarizeSiblingChat(source)}`;
  });

  const handoff: ThreadTabs["Service"]["handoff"] = Effect.fn("ThreadTabs.handoff")(
    function* (threadId, input) {
      // Sources may be sibling tabs or any other thread in this environment, and the thread
      // composing may still be a draft, so only self-reference is refused.
      const sourceIds = [...new Set(input.sourceThreadIds)];
      const { beforeMessageId, afterMessageId } = input;
      if (
        sourceIds.includes(threadId) ||
        ((beforeMessageId !== undefined || afterMessageId !== undefined) &&
          sourceIds.length !== 1) ||
        (beforeMessageId !== undefined && afterMessageId !== undefined)
      ) {
        return yield* new ThreadTabsError({
          reason: "invalid_request",
          detail: "A handoff needs other chats, and a fork point needs exactly one.",
        });
      }
      const sections = yield* Effect.forEach(sourceIds, (sourceId) => summarize(sourceId, input));
      return { text: sections.join("\n\n") };
    },
  );

  const memberships: ThreadTabs["Service"]["memberships"] = sql<{
    readonly threadId: ThreadId;
    readonly groupId: ThreadId;
  }>`
    SELECT thread_id AS "threadId", group_id AS "groupId" FROM fork_thread_tabs
    ORDER BY group_id, position, created_at
  `.pipe(Effect.mapError(internal("Could not read tab memberships.")));

  return ThreadTabs.of({ memberships, group, create, adopt, fork, handoff });
});

export const layer = Layer.effect(ThreadTabs, make);
