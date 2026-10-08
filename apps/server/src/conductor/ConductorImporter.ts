import {
  ChatAttachmentId,
  ConductorImportError,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ChatAttachment,
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
import * as Mime from "effect/http/Mime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  attachmentFileExtension,
  createAttachmentId,
  createDeterministicAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { importedMessageId, messageEvents } from "../project/AgentSessionImporter.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { ThreadTabs } from "../threadTabs/ThreadTabs.ts";
import {
  conductorIsoTime,
  conductorWorkspaceTitle,
  defaultConductorDatabasePath,
  openConductorDatabase,
  parseConductorTranscript,
  type ConductorDatabase,
  type ConductorFileRef,
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

/** The name a file is imported under. */
const attachmentName = (file: ConductorFileRef) => file.name.trim().slice(0, 255) || "attachment";

/** Stands in for a file the import could not copy. */
const unavailableText = (file: ConductorFileRef) =>
  `(Attachment not available: ${attachmentName(file)})`;

const joinParts = (parts: ReadonlyArray<string>) =>
  parts.filter((part) => part !== "").join("\n\n");

type TranscriptMessage = ReturnType<typeof parseConductorTranscript>["messages"][number];

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
    const config = yield* ServerConfig.ServerConfig;

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

    /** Conductor repositories checked out as this project, by root path or origin remote. */
    const reposFor = Effect.fn("ConductorImporter.reposFor")(function* (
      db: ConductorDatabase,
      workspaceRoot: string,
    ) {
      const root = normalizeProjectPathForComparison(workspaceRoot);
      const remote = yield* originRemoteOf(workspaceRoot);
      return (yield* query(db.repos)).filter(
        (repo) =>
          (repo.rootPath !== null && normalizeProjectPathForComparison(repo.rootPath) === root) ||
          (remote !== null &&
            repo.remoteUrl !== null &&
            normalizeGitRemoteUrl(repo.remoteUrl) === remote),
      );
    });

    /** Active Conductor workspaces of the project's repository whose worktree still exists. */
    const workspacesFor = Effect.fn("ConductorImporter.workspacesFor")(function* (
      db: ConductorDatabase,
      workspaceRoot: string,
    ) {
      const repos = yield* reposFor(db, workspaceRoot);
      const workspaces: Array<{
        workspace: ConductorWorkspace;
        tabs: ReadonlyArray<ConductorTab>;
      }> = [];
      const archivedWorkspaceIds: Array<string> = [];
      for (const repo of repos) {
        archivedWorkspaceIds.push(...(yield* query(() => db.archivedWorkspaceIds(repo.id))));
        for (const workspace of yield* query(() => db.activeWorkspaces(repo.id))) {
          const workspaceTabs = yield* query(() => db.tabs(workspace.id));
          if (workspaceTabs.length === 0) continue;
          if (!(yield* fileSystem.exists(workspace.path).pipe(Effect.orElseSucceed(() => false)))) {
            continue;
          }
          workspaces.push({ workspace, tabs: workspaceTabs });
        }
      }
      return { workspaces, archivedWorkspaceIds };
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
        return {
          available: false,
          workspaces: [],
          archivedWorkspaceIds: [],
        } satisfies ConductorWorkspaceListResult;
      }
      const found = yield* withDatabase((db) => workspacesFor(db, project.workspaceRoot));
      const workspaces = yield* Effect.forEach(
        found.workspaces,
        Effect.fn(function* ({ workspace, tabs: workspaceTabs }) {
          const firstThreadId = conductorThreadId(workspaceTabs[0]!.sessionId);
          const imported = yield* existingThread(firstThreadId);
          return {
            workspaceId: workspace.id,
            title: conductorWorkspaceTitle(workspace),
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
      return {
        available: true,
        workspaces,
        archivedWorkspaceIds: found.archivedWorkspaceIds,
      } satisfies ConductorWorkspaceListResult;
    });

    /** Copies one file into the attachment store, or `null` when it is gone or too large. */
    const importFile = (threadId: ThreadId, file: ConductorFileRef) =>
      Effect.gen(function* () {
        const stat = yield* fileSystem.stat(file.path);
        const sizeBytes = Number(stat.size);
        if (stat.type !== "File" || sizeBytes < 1) return null;
        const name = attachmentName(file);
        const mimeType = Option.getOrElse(Mime.getType(name), () =>
          file.kind === "text" ? "text/plain" : "application/octet-stream",
        );
        let attachment: ChatAttachment;
        if (file.kind === "image" && mimeType.startsWith("image/")) {
          if (sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return null;
          const id = createDeterministicAttachmentId(threadId, `conductor:${file.attachmentId}`);
          if (id === null) return null;
          attachment = { type: "image", id: ChatAttachmentId.make(id), name, mimeType, sizeBytes };
        } else {
          if (sizeBytes > PROVIDER_SEND_TURN_MAX_FILE_BYTES) return null;
          // File ids carry their extension so the asset route can find them.
          const id = createAttachmentId(threadId, attachmentFileExtension(name));
          if (id === null) return null;
          attachment = {
            type: "file",
            id: ChatAttachmentId.make(id),
            name,
            mimeType,
            sizeBytes,
            ...(name.startsWith("pasted_text") ? { source: { _tag: "pasted-text" as const } } : {}),
          };
        }
        const destination = resolveAttachmentPath({
          attachmentsDir: config.attachmentsDir,
          attachment,
        });
        if (destination === null) return null;
        yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fileSystem.copyFile(file.path, destination);
        return attachment;
      }).pipe(Effect.orElseSucceed(() => null));

    /**
     * A prompt's files as attachments. Conductor deletes a workspace's files when it archives
     * it, so a file that is gone is named in the text instead.
     */
    const importFiles = Effect.fn("ConductorImporter.importFiles")(function* (
      threadId: ThreadId,
      message: TranscriptMessage,
    ) {
      const attachments: Array<ChatAttachment> = [];
      const unavailable: Array<string> = [];
      for (const file of message.files ?? []) {
        const attachment = yield* importFile(threadId, file);
        if (attachment === null) unavailable.push(unavailableText(file));
        else attachments.push(attachment);
      }
      return {
        message: { ...message, text: joinParts([message.text, ...unavailable]) },
        attachments,
      };
    });

    const transcriptOf = (
      db: ConductorDatabase,
      tab: ConductorTab,
      workspace: ConductorWorkspace,
    ) =>
      Effect.gen(function* () {
        return parseConductorTranscript(
          yield* query(() => db.messages(tab.sessionId)),
          yield* query(() => db.attachments(tab.sessionId)),
          workspace.path,
        );
      });

    /**
     * Events that rewrite an earlier import's messages where this importer now reads Conductor
     * differently, such as a file mention it used to leave as raw text. Messages are matched by
     * their import id, so turns sent in T3 since the import are untouched, and prompts sent in
     * Conductor since then are not added. A thread whose imported roles no longer line up with
     * the transcript is left alone.
     */
    const refreshEvents = Effect.fn("ConductorImporter.refreshEvents")(function* (input: {
      readonly workspace: ConductorWorkspace;
      readonly tab: ConductorTab;
      readonly db: ConductorDatabase;
    }) {
      const threadId = conductorThreadId(input.tab.sessionId);
      const transcript = yield* transcriptOf(input.db, input.tab, input.workspace);
      const ids = transcript.messages.map((_, index) => importedMessageId(threadId, index));
      const { messages: stored } = yield* orchestrator
        .getThreadRecords(threadId, ["messages"], { messageIds: ids })
        .pipe(Effect.mapError(readFailed(`Could not read thread '${threadId}'.`)));
      const storedById = new Map(stored.map((message) => [message.id, message]));
      const stale: Array<{ readonly index: number; readonly message: TranscriptMessage }> = [];
      for (const [index, message] of transcript.messages.entries()) {
        const current = storedById.get(ids[index]!);
        if (current === undefined) continue;
        if (current.role !== message.role) return [];
        const copied = new Set(current.attachments.map((attachment) => attachment.name));
        const missing = (message.files ?? []).filter((file) => !copied.has(attachmentName(file)));
        if (current.text !== joinParts([message.text, ...missing.map(unavailableText)])) {
          stale.push({ index, message });
        }
      }
      if (stale.length === 0) return [];
      // Event ids are unique; the payloads keep their import ids so they replace the messages.
      const revision = DateTime.toEpochMillis(yield* DateTime.now);
      const events: Array<OrchestrationV2DomainEvent> = [];
      for (const { index, message } of stale) {
        const imported = yield* importFiles(threadId, message);
        for (const event of messageEvents({ threadId, index, ...imported })) {
          events.push({ ...event, id: EventId.make(`${event.id}:refresh:${revision}`) });
        }
      }
      return events;
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
        const transcript = yield* transcriptOf(input.db, tab, workspace);
        const messages = yield* Effect.forEach(transcript.messages, (message) =>
          importFiles(threadId, message),
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
        const archived = workspace.archived;
        const appThread: OrchestrationV2AppThread = {
          createdBy: "system",
          creationSource: "server",
          id: threadId,
          projectId: input.projectId,
          title: tab.title === "Untitled" ? conductorWorkspaceTitle(workspace) : tab.title,
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
          // An active workspace is moved so the user can keep working in it, and its last
          // activity is old enough that auto-settle would park it. An archived workspace is
          // already finished in Conductor, so its threads land settled.
          settledOverride: archived ? "settled" : "active",
          settledAt: archived ? DateTime.makeUnsafe(conductorIsoTime(workspace.updatedAt)) : null,
          unsettledAt: archived ? null : yield* DateTime.now,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt:
            input.pinned && workspace.pinnedAt !== null
              ? DateTime.makeUnsafe(conductorIsoTime(workspace.pinnedAt))
              : null,
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
          ...messages.flatMap(({ message, attachments }, index) =>
            messageEvents({ threadId, index, message, attachments }),
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

    const workspaceNotFound = () =>
      new ConductorImportError({
        reason: "workspace_not_found",
        detail: "That Conductor workspace is not a workspace of this project.",
      });

    /**
     * Imports a workspace's open tabs as one tab group of threads that run in Conductor's
     * worktree on its branch. Claude and Codex tabs resume their agent session; Cursor tabs
     * hand their history to the next turn instead. An archived workspace's threads are settled,
     * and its worktree does not have to still exist. Importing again updates the threads of an
     * earlier import with what this importer now reads from Conductor.
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
          const workspace = yield* query(() => db.workspace(input.workspaceId));
          const repos = yield* reposFor(db, project.workspaceRoot);
          if (workspace === null || !repos.some((repo) => repo.id === workspace.repoId)) {
            return yield* workspaceNotFound();
          }
          if (
            !workspace.archived &&
            !(yield* fileSystem.exists(workspace.path).pipe(Effect.orElseSucceed(() => false)))
          ) {
            return yield* workspaceNotFound();
          }
          const workspaceTabs = yield* query(() => db.tabs(workspace.id));
          if (workspaceTabs.length === 0) return yield* workspaceNotFound();

          const threadIds = workspaceTabs.map((tab) => conductorThreadId(tab.sessionId));
          const missing: Array<ConductorTab> = [];
          const imported: Array<ConductorTab> = [];
          for (const tab of workspaceTabs) {
            const thread = yield* existingThread(conductorThreadId(tab.sessionId));
            if (thread === null) missing.push(tab);
            else if (thread.deletedAt === null) imported.push(tab);
          }
          const settled = workspace.archived;
          let refreshedThreadCount = 0;
          for (const tab of imported) {
            const events = yield* refreshEvents({ workspace, tab, db });
            if (events.length === 0) continue;
            yield* eventSink.write({ events }).pipe(
              Effect.mapError(
                (cause) =>
                  new ConductorImportError({
                    reason: "write_failed",
                    detail: `Could not update the imported Conductor tab '${tab.title}'.`,
                    cause,
                  }),
              ),
            );
            refreshedThreadCount += 1;
          }
          if (missing.length === 0) {
            return {
              threadIds,
              importedThreadCount: 0,
              refreshedThreadCount,
              settled,
            } satisfies ConductorWorkspaceImportResult;
          }

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
              workspace,
              tab,
              // The pin belongs on the group's sidebar row, which is its first tab. Archived
              // threads stay out of the pinned list; they are settled history.
              pinned:
                !workspace.archived && workspace.pinnedAt !== null && tab === workspaceTabs[0],
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
          return {
            threadIds,
            importedThreadCount: missing.length,
            refreshedThreadCount,
            settled,
          } satisfies ConductorWorkspaceImportResult;
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
