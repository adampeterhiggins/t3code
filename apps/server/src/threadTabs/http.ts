import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  EnvironmentHttpApi,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { summarizeSiblingMessages } from "./summary.ts";

interface TabRow {
  readonly threadId: string;
  readonly groupId: string;
  readonly position: number;
}

export const threadTabsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "threadTabs",
  Effect.fnUntraced(function* (handlers) {
    const sql = yield* SqlClient.SqlClient;
    const snapshots = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;

    const groupFor = Effect.fn("ThreadTabs.groupFor")(function* (threadId: ThreadId) {
      const source = yield* snapshots.getThreadShellById(threadId);
      if (Option.isNone(source)) return null;

      const membership = yield* sql<TabRow>`
        SELECT thread_id AS "threadId", group_id AS "groupId", position
        FROM fork_thread_tabs WHERE thread_id = ${threadId}
      `;
      const groupId = (membership[0]?.groupId ?? threadId) as ThreadId;
      const rows = yield* sql<TabRow>`
        SELECT thread_id AS "threadId", group_id AS "groupId", position
        FROM fork_thread_tabs WHERE group_id = ${groupId} ORDER BY position, created_at
      `;
      const siblings =
        rows.length === 0
          ? [source.value]
          : yield* Effect.forEach(
              rows,
              (row) =>
                snapshots
                  .getThreadShellById(ThreadId.make(row.threadId))
                  .pipe(Effect.map(Option.getOrNull)),
              { concurrency: 8 },
            );
      const tabs = siblings
        .filter((thread) => thread !== null)
        .map((thread) => ({
          threadId: thread.id,
          title: thread.title,
          modelSelection: thread.modelSelection,
        }));
      return { groupId, tabs };
    });

    return handlers
      .handle(
        "memberships",
        Effect.fn("environment.threadTabs.memberships")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* sql<{ readonly threadId: ThreadId; readonly groupId: ThreadId }>`
            SELECT thread_id AS "threadId", group_id AS "groupId" FROM fork_thread_tabs
            ORDER BY group_id, position, created_at
          `.pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
        }),
      )
      .handle(
        "list",
        Effect.fn("environment.threadTabs.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const group = yield* groupFor(args.params.threadId).pipe(
            Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
          );
          if (!group) return yield* failEnvironmentNotFound("thread_not_found");
          return group;
        }),
      )
      .handle(
        "create",
        Effect.fn("environment.threadTabs.create")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const source = yield* snapshots
            .getThreadShellById(args.params.threadId)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
          if (Option.isNone(source)) return yield* failEnvironmentNotFound("thread_not_found");
          const target = yield* snapshots
            .getThreadShellById(args.payload.threadId)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
          if (Option.isSome(target)) {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }
          const sourceThread = source.value;
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          const crypto = yield* Crypto.Crypto;
          const commandId = CommandId.make(
            yield* crypto.randomUUIDv4.pipe(
              Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
            ),
          );

          // Membership is written before the thread exists so clients that refetch
          // memberships on the new shell never see it as a standalone thread.
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const existing = yield* sql<TabRow>`
              SELECT thread_id AS "threadId", group_id AS "groupId", position
              FROM fork_thread_tabs WHERE thread_id = ${sourceThread.id}
            `;
                const groupId = existing[0]?.groupId ?? sourceThread.id;
                yield* sql`
              INSERT OR IGNORE INTO fork_thread_tabs (thread_id, group_id, position, created_at)
              VALUES (${sourceThread.id}, ${groupId}, 0, ${sourceThread.createdAt})
            `;
                const max = yield* sql<{ readonly position: number }>`
              SELECT COALESCE(MAX(position), 0) AS position FROM fork_thread_tabs WHERE group_id = ${groupId}
            `;
                yield* sql`
              INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at)
              VALUES (${args.payload.threadId}, ${groupId}, ${(max[0]?.position ?? 0) + 1}, ${createdAt})
            `;
              }),
            )
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));

          yield* engine
            .dispatch({
              type: "thread.create",
              commandId,
              threadId: args.payload.threadId,
              projectId: sourceThread.projectId,
              title: "New tab",
              modelSelection: args.payload.modelSelection,
              runtimeMode: sourceThread.runtimeMode,
              interactionMode: sourceThread.interactionMode,
              branch: sourceThread.branch,
              worktreePath: sourceThread.worktreePath,
              createdAt,
            })
            .pipe(
              Effect.tapError(() =>
                sql`DELETE FROM fork_thread_tabs WHERE thread_id = ${args.payload.threadId}`.pipe(
                  Effect.ignore,
                ),
              ),
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_dispatch_failed", cause),
              ),
            );

          const group = yield* groupFor(args.payload.threadId).pipe(
            Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
          );
          if (!group)
            return yield* failEnvironmentInternal("internal_error", "New tab was not projected");
          return group;
        }),
      )
      .handle(
        "handoff",
        Effect.fn("environment.threadTabs.handoff")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const group = yield* groupFor(args.params.threadId).pipe(
            Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
          );
          if (!group) return yield* failEnvironmentNotFound("thread_not_found");
          const sourceIds = [...new Set(args.payload.sourceThreadIds)];
          if (
            sourceIds.includes(args.params.threadId) ||
            sourceIds.some((id) => !group.tabs.some((tab) => tab.threadId === id))
          ) {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }
          const sections = yield* Effect.forEach(sourceIds, (sourceId) =>
            snapshots.getThreadDetailSnapshot(sourceId, { turnLimit: 8 }).pipe(
              Effect.map((detail) => {
                const tab = group.tabs.find((entry) => entry.threadId === sourceId);
                return Option.isSome(detail) && tab
                  ? `Source thread: ${sourceId} (snapshot ${detail.value.snapshotSequence})\n${summarizeSiblingMessages(tab.title, detail.value.thread.messages)}`
                  : "";
              }),
            ),
          ).pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
          return {
            text: sections.filter(Boolean).join("\n\n"),
          };
        }),
      );
  }),
);
