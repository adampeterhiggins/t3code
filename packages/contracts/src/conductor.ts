import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Agents a Conductor tab can run. Cursor tabs include Conductor's Grok models. */
export const ConductorAgent = Schema.Literals(["claude", "codex", "cursor"]);
export type ConductorAgent = typeof ConductorAgent.Type;

/** One open chat tab of a Conductor workspace. */
export const ConductorTabSummary = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  agent: ConductorAgent,
  messageCount: NonNegativeInt,
});
export type ConductorTabSummary = typeof ConductorTabSummary.Type;

/**
 * An active Conductor workspace of the project's repository: a worktree on its own branch
 * with one or more chat tabs. `threadId` is the first tab of an earlier import.
 */
export const ConductorWorkspaceSummary = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  /** The workspace's title in Conductor's sidebar. */
  title: TrimmedNonEmptyString,
  /** Conductor's directory name, such as `yaounde`. */
  name: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  path: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
  tabs: Schema.Array(ConductorTabSummary),
  threadId: Schema.NullOr(ThreadId),
});
export type ConductorWorkspaceSummary = typeof ConductorWorkspaceSummary.Type;

export const ConductorWorkspaceListInput = Schema.Struct({ projectId: ProjectId });
export type ConductorWorkspaceListInput = typeof ConductorWorkspaceListInput.Type;

export const ConductorWorkspaceListResult = Schema.Struct({
  /** False when Conductor has no database on this environment. */
  available: Schema.Boolean,
  workspaces: Schema.Array(ConductorWorkspaceSummary),
  /**
   * Archived workspaces of the same repositories, newest first. They are not in
   * `workspaces`; import all uses these ids when the user includes archived threads.
   * Missing on older servers, which only listed active workspaces.
   */
  archivedWorkspaceIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ConductorWorkspaceListResult = typeof ConductorWorkspaceListResult.Type;

export const ConductorWorkspaceImportInput = Schema.Struct({
  projectId: ProjectId,
  workspaceId: TrimmedNonEmptyString,
});
export type ConductorWorkspaceImportInput = typeof ConductorWorkspaceImportInput.Type;

/** The imported tabs in order; the first is the group's sidebar row. */
export const ConductorWorkspaceImportResult = Schema.Struct({
  threadIds: Schema.Array(ThreadId),
  /** Tabs written by this call. Zero when every tab already had a thread. */
  importedThreadCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** Threads of an earlier import whose messages this call rewrote. */
  refreshedThreadCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** The workspace was archived in Conductor, so its threads are settled. */
  settled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ConductorWorkspaceImportResult = typeof ConductorWorkspaceImportResult.Type;

export class ConductorImportError extends Schema.TaggedError<ConductorImportError>()(
  "ConductorImportError",
  {
    reason: Schema.Literals([
      "unavailable",
      "project_not_found",
      "workspace_not_found",
      "read_failed",
      "write_failed",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
