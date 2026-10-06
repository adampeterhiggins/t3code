import {
  ConductorImportError,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ConductorAgent,
  type ConductorWorkspaceImportInput,
  type ConductorWorkspaceImportResult,
  type ConductorWorkspaceListInput,
  type ConductorWorkspaceListResult,
  type ConductorWorkspaceSummary,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type ProjectId,
} from "@t3tools/contracts";
import { normalizeGitRemoteUrl, parseOriginUrlFromGitConfig } from "@t3tools/shared/git";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { messageEvents } from "../project/AgentSessionImporter.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { ThreadTabs } from "../threadTabs/ThreadTabs.ts";
import {
  conductorIsoTime,
  defaultConductorDatabasePath,
  openConductorDatabase,
  parseConductorTranscript,
  type ConductorDatabase,
  type ConductorTab,
  type ConductorWorkspace,
} from "./conductorDatabase.ts";

const IMPORT_EVENT_PREFIX = "conductor-import:v1";
const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** T3's built-in provider for each Conductor agent. */
const DRIVER_BY_AGENT: Record<ConductorAgent, ProviderDriverKind> = {
  claude: ProviderDriverKind.make("claudeAgent"),
  codex: ProviderDriverKind.make("codex"),
  cursor: ProviderDriverKind.make("cursor"),
};

/** Imports are keyed by Conductor tab, so importing a workspace twice reuses its threads. */
export function conductorThreadId(sessionId: string): ThreadId {
  return ThreadId.make(`conductor:${sessionId}`);
}

/**
 * The agent session T3 can resume. Claude and Codex keep their sessions in their own homes,
 * which T3 reads too; Conductor's Cursor sessions live in its private SDK store.
 */
function resumableSessionId(tab: ConductorTab): string | null {
  if (tab.nativeSessionId === null || tab.nativeSessionId.trim() === "") return null;
  if (tab.agent === "claude") {
    return CLAUDE_SESSION_ID_PATTERN.test(tab.nativeSessionId) ? tab.nativeSessionId : null;
  }
  return tab.agent === "codex" ? tab.nativeSessionId : null;
}

function modelFor(tab: ConductorTab, transcriptModel: string | null): string {
  const driver = DRIVER_BY_AGENT[tab.agent];
  // Conductor's Claude aliases (`opus-1m`) are not T3 slugs; the transcript has the real id.
  if (tab.agent === "claude" && transcriptModel?.startsWith("claude-")) return transcriptModel;
  if (tab.agent === "codex" && tab.model !== null) return tab.model;
  return DEFAULT_MODEL_BY_PROVIDER[driver] ?? DEFAULT_MODEL;
}

const readFailed = (detail: string) => (cause: unknown) =>
  new ConductorImportError({ reason: "read_failed", detail, cause });

const make = (databasePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projects = yield* ProjectService.ProjectService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const tabs = yield* ThreadTabs;

    const isAvailable = fileSystem.exists(databasePath).pipe(Effect.orElseSucceed(() => false));

    const withDatabase = <A, E>(use: (db: ConductorDatabase) => Effect.Effect<A, E>) =>
      Effect.acquireUseRelease(
        Effect.try({
          try: () => openConductorDatabase(databasePath),
          catch: readFailed("Could not open Conductor's database."),
        }),
        use,
        (db) => Effect.sync(() => db.close()),
      );

    const query = <A>(run: () => A) =>
      Effect.try({ try: run, catch: readFailed("Could not read Conductor's database.") });

    const getProject = (projectId: ProjectId) =>
      projects.getById(projectId).pipe(
        Effect.mapError(readFailed("Could not read the project.")),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new ConductorImportError({
                  reason: "project_not_found",
                  detail: `Project '${projectId}' does not exist.`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );

    /** The project's normalized origin, read from git config so a worktree root works too. */
    const originRemoteOf = Effect.fn("ConductorImporter.originRemoteOf")(function* (root: string) {
      const dotGit = path.join(root, ".git");
      const stat = yield* fileSystem.stat(dotGit).pipe(Effect.option);
      if (Option.isNone(stat)) return null;
      let gitDir = dotGit;
      if (stat.value.type !== "Directory") {
        const pointer = yield* fileSystem
          .readFileString(dotGit)
          .pipe(Effect.orElseSucceed(() => ""));
        const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
        if (!target) return null;
        gitDir = path.resolve(root, target);
        const commonDir = yield* fileSystem
          .readFileString(path.join(gitDir, "commondir"))
          .pipe(Effect.orElseSucceed(() => ""));
        if (commonDir.trim() !== "") gitDir = path.resolve(gitDir, commonDir.trim());
      }
      const config = yield* fileSystem
        .readFileString(path.join(gitDir, "config"))
        .pipe(Effect.orElseSucceed(() => ""));
      const origin = parseOriginUrlFromGitConfig(config);
      return origin === null ? null : normalizeGitRemoteUrl(origin);
    });

    /** Conductor workspaces of the project's repository whose worktree still exists. */
    const workspacesFor = Effect.fn("ConductorImporter.workspacesFor")(function* (
      db: ConductorDatabase,
      workspaceRoot: string,
    ) {
      const root = normalizeProjectPathForComparison(workspaceRoot);
      const remote = yield* originRemoteOf(workspaceRoot);
      const repos = (yield* query(db.repos)).filter(
        (repo) =>
          (repo.rootPath !== null && normalizeProjectPathForComparison(repo.rootPath) === root) ||
          (remote !== null &&
            repo.remoteUrl !== null &&
            normalizeGitRemoteUrl(repo.remoteUrl) === remote),
      );
      const workspaces: Array<{
        workspace: ConductorWorkspace;
        tabs: ReadonlyArray<ConductorTab>;
      }> = [];
      for (const repo of repos) {
        for (const workspace of yield* query(() => db.activeWorkspaces(repo.id))) {
          const workspaceTabs = yield* query(() => db.tabs(workspace.id));
          if (workspaceTabs.length === 0) continue;
          if (!(yield* fileSystem.exists(workspace.path).pipe(Effect.orElseSucceed(() => false)))) {
            continue;
          }
          workspaces.push({ workspace, tabs: workspaceTabs });
        }
      }
      return workspaces;
    });

    const existingThread = (threadId: ThreadId) =>
      orchestrator
        .getThreadShell(threadId)
        .pipe(Effect.mapError(readFailed(`Could not read thread '${threadId}'.`)));

    const listWorkspaces = Effect.fn("ConductorImporter.listWorkspaces")(function* (
      input: ConductorWorkspaceListInput,
    ) {
      const project = yield* getProject(input.projectId);
      if (!(yield* isAvailable)) {
        return { available: false, workspaces: [] } satisfies ConductorWorkspaceListResult;
      }
      const found = yield* withDatabase((db) => workspacesFor(db, project.workspaceRoot));
      const workspaces = yield* Effect.forEach(
        found,
        Effect.fn(function* ({ workspace, tabs: workspaceTabs }) {
          const firstThreadId = conductorThreadId(workspaceTabs[0]!.sessionId);
          const imported = yield* existingThread(firstThreadId);
          return {
            workspaceId: workspace.id,
            name: workspace.name,
            branch: workspace.branch?.trim() || null,
            path: workspace.path,
            updatedAt: conductorIsoTime(workspace.updatedAt),
            tabs: workspaceTabs.map((tab) => ({
              sessionId: tab.sessionId,
              title: tab.title,
              agent: tab.agent,
              messageCount: tab.userMessageCount,
            })),
            threadId: imported === null || imported.deletedAt !== null ? null : firstThreadId,
          } satisfies ConductorWorkspaceSummary;
        }),
      );
      return { available: true, workspaces } satisfies ConductorWorkspaceListResult;
    });

    const threadEvents = (input: {
      readonly projectId: ProjectId;
      readonly workspace: ConductorWorkspace;
      readonly tab: ConductorTab;
      readonly pinned: boolean;
      readonly db: ConductorDatabase;
    }) =>
      Effect.gen(function* () {
        const { tab, workspace } = input;
        const threadId = conductorThreadId(tab.sessionId);
        const transcript = parseConductorTranscript(
          yield* query(() => input.db.messages(tab.sessionId)),
        );
        const driver = DRIVER_BY_AGENT[tab.agent];
        const providerInstanceId = ProviderInstanceId.make(driver);
        const nativeId = resumableSessionId(tab);
        const providerThreadId =
          nativeId === null
            ? null
            : idAllocator.derive.providerThread({ driver, nativeThreadId: nativeId });
        const createdAt = DateTime.makeUnsafe(conductorIsoTime(tab.createdAt));
        const updatedAt = DateTime.makeUnsafe(
          transcript.messages.at(-1)?.createdAt ?? conductorIsoTime(tab.createdAt),
        );
        const appThread: OrchestrationV2AppThread = {
          createdBy: "system",
          creationSource: "server",
          id: threadId,
          projectId: input.projectId,
          title: tab.title === "Untitled" ? workspace.name : tab.title,
          providerInstanceId,
          modelSelection: {
            instanceId: providerInstanceId,
            model: modelFor(tab, transcript.model),
          },
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: workspace.branch?.trim() || null,
          worktreePath: workspace.path,
          linkedPullRequest: null,
          branchPullRequest: null,
          activeProviderThreadId: providerThreadId,
          historyOrigin: "v1_import",
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt,
          updatedAt,
          archivedAt: null,
          settledOverride: "settled",
          settledAt: updatedAt,
          unsettledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: input.pinned ? updatedAt : null,
          pinOrderKey: null,
          activeOrderKey: null,
          lastVisitedAt: null,
          deletedAt: null,
        };
        const events: Array<OrchestrationV2DomainEvent> = [
          {
            id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
            type: "thread.created",
            threadId,
            providerInstanceId,
            occurredAt: createdAt,
            payload: appThread,
          },
          ...transcript.messages.flatMap((message, index) =>
            messageEvents({ threadId, index, message }),
          ),
        ];
        if (providerThreadId !== null && nativeId !== null) {
          const providerThread: OrchestrationV2ProviderThread = {
            id: providerThreadId,
            driver,
            providerInstanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: { driver, nativeId, strength: "strong" },
            nativeConversationHeadRef: null,
            nativeMetadata: { importedNativeId: nativeId },
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            pendingBackgroundTasks: [],
            createdAt,
            updatedAt,
          };
          events.push({
            id: EventId.make(`${IMPORT_EVENT_PREFIX}:provider-thread:${providerThreadId}`),
            type: "provider-thread.updated",
            threadId,
            driver,
            providerInstanceId,
            occurredAt: updatedAt,
            payload: providerThread,
          });
        }
        return events;
      });

    /**
     * Imports a workspace's open tabs as one tab group of threads that run in Conductor's
     * worktree on its branch. Claude and Codex tabs resume their agent session; Cursor tabs
     * hand their history to the next turn instead.
     */
    const importWorkspace = Effect.fn("ConductorImporter.importWorkspace")(function* (
      input: ConductorWorkspaceImportInput,
    ) {
      const project = yield* getProject(input.projectId);
      if (!(yield* isAvailable)) {
        return yield* new ConductorImportError({
          reason: "unavailable",
          detail: "Conductor's database was not found on this machine.",
        });
      }
      return yield* withDatabase((db) =>
        Effect.gen(function* () {
          const found = (yield* workspacesFor(db, project.workspaceRoot)).find(
            (candidate) => candidate.workspace.id === input.workspaceId,
          );
          if (found === undefined) {
            return yield* new ConductorImportError({
              reason: "workspace_not_found",
              detail: "That Conductor workspace is not an active workspace of this project.",
            });
          }
          const threadIds = found.tabs.map((tab) => conductorThreadId(tab.sessionId));
          const missing: Array<ConductorTab> = [];
          for (const tab of found.tabs) {
            if ((yield* existingThread(conductorThreadId(tab.sessionId))) === null) {
              missing.push(tab);
            }
          }
          if (missing.length === 0) return { threadIds } satisfies ConductorWorkspaceImportResult;

          yield* tabs
            .adopt(threadIds)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ConductorImportError({ reason: "write_failed", detail: cause.detail, cause }),
              ),
            );
          for (const tab of missing) {
            const events = yield* threadEvents({
              projectId: project.id,
              workspace: found.workspace,
              tab,
              // The pin belongs on the group's sidebar row, which is its first tab.
              pinned: found.workspace.pinnedAt !== null && tab === found.tabs[0],
              db,
            });
            yield* eventSink.write({ events }).pipe(
              Effect.mapError(
                (cause) =>
                  new ConductorImportError({
                    reason: "write_failed",
                    detail: `Could not import the Conductor tab '${tab.title}'.`,
                    cause,
                  }),
              ),
            );
          }
          return { threadIds } satisfies ConductorWorkspaceImportResult;
        }),
      );
    });

    return { listWorkspaces, importWorkspace };
  });

type ConductorImporterShape = Effect.Success<ReturnType<typeof make>>;

export class ConductorImporter extends Context.Service<ConductorImporter, ConductorImporterShape>()(
  "t3/conductor/ConductorImporter",
) {}

export const layerWithDatabasePath = (databasePath: string) =>
  Layer.effect(ConductorImporter, make(databasePath));

export const layer = Layer.effect(
  ConductorImporter,
  Effect.suspend(() => make(defaultConductorDatabasePath())),
);
