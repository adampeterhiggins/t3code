import {
  WS_METHODS,
  type AgentSessionSummary,
  type ConductorWorkspaceSummary,
  type ThreadId,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/cli";

import {
  LiveUsageError,
  formatLocalMinute,
  jsonFlag,
  liveLocationFlags,
  loadLiveShell,
  matchId,
  printJson,
  resolveLiveProject,
  rpc,
  withLiveRpc,
  type LiveProject,
  type LiveRpcClient,
} from "./liveRpc.ts";

const PREVIEW_MAX_CHARS = 70;

export type ImportSource = "claude" | "codex" | "conductor";

export type ImportRow =
  | {
      readonly kind: "session";
      readonly id: string;
      readonly source: ImportSource;
      readonly title: string;
      readonly updatedAt: string;
      readonly threadId: ThreadId | null;
      readonly session: AgentSessionSummary;
    }
  | {
      readonly kind: "conductor";
      readonly id: string;
      readonly source: ImportSource;
      readonly title: string;
      readonly updatedAt: string;
      readonly threadId: ThreadId | null;
      readonly workspace: ConductorWorkspaceSummary;
    };

/** Every importable conversation for one project, newest first. */
export const importRows = (
  sessions: ReadonlyArray<AgentSessionSummary>,
  workspaces: ReadonlyArray<ConductorWorkspaceSummary>,
): ReadonlyArray<ImportRow> =>
  [
    ...sessions.map((session): ImportRow => ({
      kind: "session",
      id: session.providerSessionId,
      source: session.provider === "claudeAgent" ? "claude" : "codex",
      title: session.title,
      updatedAt: session.updatedAt,
      threadId: session.threadId,
      session,
    })),
    ...workspaces.map((workspace): ImportRow => ({
      kind: "conductor",
      id: workspace.workspaceId,
      source: "conductor",
      title:
        workspace.branch === null ? workspace.title : `${workspace.title} [${workspace.branch}]`,
      updatedAt: workspace.updatedAt,
      threadId: workspace.threadId,
      workspace,
    })),
  ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const preview = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_MAX_CHARS
    ? `${line.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : line;
};

export const formatImportRow = (row: ImportRow) =>
  [
    row.id,
    row.source.padEnd(9),
    formatLocalMinute(row.updatedAt),
    preview(row.title),
    row.threadId === null ? "" : `-> ${row.threadId}`,
  ]
    .join("  ")
    .trimEnd();

const loadRows = Effect.fn("cli.import.loadRows")(function* (
  client: LiveRpcClient,
  project: LiveProject,
  source: Option.Option<ImportSource>,
) {
  const wants = (candidate: ImportSource) => Option.isNone(source) || source.value === candidate;
  const sessions =
    wants("claude") || wants("codex")
      ? yield* rpc(client[WS_METHODS.agentSessionsList]({ projectId: project.id }))
      : { sessions: [], truncated: false };
  const conductor = wants("conductor")
    ? yield* rpc(client[WS_METHODS.conductorListWorkspaces]({ projectId: project.id }))
    : { available: false, workspaces: [] };
  const rows = importRows(sessions.sessions, conductor.available ? conductor.workspaces : []);
  return {
    rows: rows.filter((row) => wants(row.source)),
    truncated: sessions.truncated,
  };
});

const sourceFlag = Flag.Literals("source", ["claude", "codex", "conductor"]).pipe(
  Flag.withDescription("Only list conversations from this source."),
  Flag.optional,
);

const importListCommand = Command.make("list", {
  ...liveLocationFlags,
  project: Argument.String("project").pipe(
    Argument.withDescription(
      "Project id or a path inside the project. Defaults to this directory.",
    ),
    Argument.withDefault("."),
  ),
  source: sourceFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "List a project's recent Claude Code, Codex, and Conductor conversations. An arrow marks the thread already holding one.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 import cli",
      Effect.fn("cli.import.list")(function* (client) {
        const { projects } = yield* loadLiveShell(client);
        const project = yield* resolveLiveProject(projects, flags.project);
        const { rows, truncated } = yield* loadRows(client, project, flags.source);
        if (flags.json) {
          return yield* printJson({
            projectId: project.id,
            conversations: rows.map(({ id, source, title, updatedAt, threadId }) => ({
              id,
              source,
              title,
              updatedAt,
              threadId,
            })),
            truncated,
          });
        }
        if (rows.length === 0) {
          return yield* Console.log(`No conversations to import for ${project.title}.`);
        }
        for (const row of rows) yield* Console.log(formatImportRow(row));
        if (truncated) {
          yield* Console.log("Only the newest Claude Code and Codex conversations are listed.");
        }
      }),
    ),
  ),
);

export const importCommand = Command.make("import", {
  ...liveLocationFlags,
  id: Argument.String("id").pipe(
    Argument.withDescription(
      "Conversation or Conductor workspace id from `t3 import list`, or a unique part of it.",
    ),
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription("Project id or a path inside the project. Defaults to this directory."),
    Flag.withDefault("."),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Import a Claude Code, Codex, or Conductor conversation as a thread and print its id.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 import cli",
      Effect.fn("cli.import.one")(function* (client) {
        const { projects } = yield* loadLiveShell(client);
        const project = yield* resolveLiveProject(projects, flags.project);
        const { rows } = yield* loadRows(client, project, Option.none());
        const match = matchId(rows, (row) => row.id, flags.id);
        if (match.type === "none") {
          return yield* new LiveUsageError({
            detail: `No recent conversation in ${project.title} matches '${flags.id}'. Run t3 import list.`,
          });
        }
        if (match.type === "ambiguous") {
          return yield* new LiveUsageError({
            detail: `'${flags.id}' matches several conversations: ${match.ids.join(", ")}.`,
          });
        }
        const row = match.item;
        const report = (threadId: ThreadId, imported: boolean) =>
          flags.json
            ? printJson({ id: row.id, source: row.source, threadId, imported })
            : Console.log(threadId);
        if (row.threadId !== null) {
          if (!flags.json) yield* Console.error("Already imported.");
          return yield* report(row.threadId, false);
        }
        const threadIds =
          row.kind === "session"
            ? ((yield* rpc(
                client[WS_METHODS.agentSessionsImport]({
                  projectId: project.id,
                  expectedWorkspaceRoot: project.workspaceRoot,
                  session: {
                    providerInstanceId: row.session.providerInstanceId,
                    providerSessionId: row.session.providerSessionId,
                  },
                }),
              )).threadIds ?? [])
            : (yield* rpc(
                client[WS_METHODS.conductorImportWorkspace]({
                  projectId: project.id,
                  workspaceId: row.workspace.workspaceId,
                }),
              )).threadIds;
        const [threadId] = threadIds;
        if (threadId === undefined) {
          return yield* new LiveUsageError({
            detail:
              "The conversation was not imported. It may have changed on disk, or an earlier import of it was deleted.",
          });
        }
        yield* report(threadId, true);
      }),
    ),
  ),
  Command.withSubcommands([importListCommand]),
);
