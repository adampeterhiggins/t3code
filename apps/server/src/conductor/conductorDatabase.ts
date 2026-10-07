// node:sqlite reads Conductor's live database read-only.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import type { ConductorAgent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Where the Conductor macOS app keeps its database. */
export function defaultConductorDatabasePath(): string {
  return NodePath.join(
    NodeOS.homedir(),
    "Library",
    "Application Support",
    "com.conductor.app",
    "conductor.db",
  );
}

export interface ConductorRepo {
  readonly id: string;
  readonly remoteUrl: string | null;
  readonly rootPath: string | null;
}

export interface ConductorWorkspace {
  readonly id: string;
  readonly repoId: string;
  readonly name: string;
  readonly branch: string | null;
  readonly path: string;
  readonly pinnedAt: string | null;
  /** A name the user gave the workspace. */
  readonly customName: string | null;
  readonly prTitle: string | null;
  readonly updatedAt: string;
  /** Conductor has archived this workspace. Its worktree is usually already gone. */
  readonly archived: boolean;
}

export interface ConductorTab {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly agent: ConductorAgent;
  /** The agent's own session id: a Claude session or a Codex thread. */
  readonly nativeSessionId: string | null;
  /** Conductor's model alias, such as `opus-1m` or `gpt-5.4`. */
  readonly model: string | null;
  readonly createdAt: string;
  readonly userMessageCount: number;
}

export interface ConductorMessageRow {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt: string;
}

/**
 * A file sent with a prompt, or a diff comment sent to the agent (`review`). Comment fields are
 * set only for reviews.
 */
export interface ConductorAttachmentRow {
  readonly id: string;
  readonly messageId: string;
  readonly type: string;
  readonly name: string;
  readonly path: string | null;
  readonly commentFilePath: string | null;
  readonly commentStartLine: number | null;
  readonly commentEndLine: number | null;
  readonly commentBody: string | null;
}

/** A file to copy into the imported message, from a Conductor workspace's `.context`. */
export interface ConductorFileRef {
  readonly attachmentId: string;
  readonly kind: "image" | "text" | "file";
  readonly name: string;
  readonly path: string;
}

export interface ConductorTranscriptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly files?: ReadonlyArray<ConductorFileRef>;
}

export interface ConductorTranscript {
  readonly messages: ReadonlyArray<ConductorTranscriptMessage>;
  /** The provider model id of the latest reply, such as `claude-fable-5-1`. */
  readonly model: string | null;
}

/** Conductor writes both SQLite `datetime('now')` and ISO timestamps; both are UTC. */
export function conductorIsoTime(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}.000Z`
    : DateTime.formatIso(DateTime.makeUnsafe(value));
}

// Conductor's inline mention of an attachment in a prompt: `@⟦name⟧(attachment:<id>)`.
const ATTACHMENT_MENTION = /@⟦[^⟧]*⟧\(attachment:[^)\s]+\)/g;

function reviewText(attachment: ConductorAttachmentRow): string | null {
  const body = attachment.commentBody?.trim();
  if (!body) return null;
  const { commentStartLine: start, commentEndLine: end } = attachment;
  const lines =
    start === null
      ? ""
      : end !== null && end !== start
        ? ` lines ${start}–${end}`
        : ` line ${start}`;
  const target = attachment.commentFilePath ?? attachment.name;
  return `Review comment on \`${target}\`${lines}:\n\n${body}`;
}

/** A prompt's text with attachment mentions removed, its review comments, and its files. */
function userMessage(
  row: ConductorMessageRow,
  attachments: ReadonlyArray<ConductorAttachmentRow>,
): ConductorTranscriptMessage | null {
  const reviews = attachments.flatMap((attachment) =>
    attachment.type === "review" ? (reviewText(attachment) ?? []) : [],
  );
  const files = attachments.flatMap((attachment): Array<ConductorFileRef> => {
    const kind = attachment.type;
    if ((kind !== "image" && kind !== "text" && kind !== "file") || !attachment.path) return [];
    return [{ attachmentId: attachment.id, kind, name: attachment.name, path: attachment.path }];
  });
  const prompt = row.content.replace(ATTACHMENT_MENTION, "").trim();
  const text = [prompt, ...reviews].filter((part) => part !== "").join("\n\n");
  if (text === "" && files.length === 0) return null;
  return {
    role: "user",
    text,
    createdAt: conductorIsoTime(row.createdAt),
    ...(files.length === 0 ? {} : { files }),
  };
}

/**
 * The title Conductor's sidebar shows: the user's name for the workspace, its pull request's
 * title, or its branch in words (`ah/google-drive-access` is "Google drive access").
 */
export function conductorWorkspaceTitle(workspace: ConductorWorkspace): string {
  if (workspace.customName) return workspace.customName;
  if (workspace.prTitle) return workspace.prTitle;
  const words = (workspace.branch?.split("/").at(-1) ?? "").replace(/[-_]+/g, " ").trim();
  return words === "" ? workspace.name : words[0]!.toUpperCase() + words.slice(1);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Conductor stores every agent's output as Claude Agent SDK messages. Keeps the prompts, with
 * their files and the diff comments sent with them, and the top-level reply text; tool calls,
 * tool results and subagent output are dropped, so the replies between two prompts merge into
 * one message.
 */
export function parseConductorTranscript(
  rows: ReadonlyArray<ConductorMessageRow>,
  attachments: ReadonlyArray<ConductorAttachmentRow> = [],
): ConductorTranscript {
  const attachmentsByMessage = Map.groupBy(attachments, (attachment) => attachment.messageId);
  const messages: Array<ConductorTranscriptMessage> = [];
  let model: string | null = null;
  for (const row of rows) {
    if (row.role === "user") {
      const message = userMessage(row, attachmentsByMessage.get(row.id) ?? []);
      if (message !== null) messages.push(message);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      continue;
    }
    const sdkMessage = record(parsed);
    if (sdkMessage?.type !== "assistant" || sdkMessage.parent_tool_use_id != null) continue;
    const message = record(sdkMessage.message);
    if (typeof message?.model === "string" && message.model !== "<synthetic>") {
      model = message.model;
    }
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = content
      .map((block) => {
        const part = record(block);
        return part?.type === "text" && typeof part.text === "string" ? part.text.trim() : "";
      })
      .filter((part) => part !== "")
      .join("\n\n");
    if (text === "") continue;
    const previous = messages.at(-1);
    if (previous?.role === "assistant") {
      messages[messages.length - 1] = { ...previous, text: `${previous.text}\n\n${text}` };
    } else {
      messages.push({ role: "assistant", text, createdAt: conductorIsoTime(row.createdAt) });
    }
  }
  return { messages, model };
}

const AGENTS: ReadonlyArray<ConductorAgent> = ["claude", "codex", "cursor"];

/** A read-only connection to Conductor's database. Close it when done. */
export function openConductorDatabase(path: string) {
  const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  const all = <T>(sql: string, ...params: Array<string>) =>
    db.prepare(sql).all(...params) as unknown as ReadonlyArray<T>;

  const workspaceColumns = `local_id AS id, repository_id AS repoId, directory_name AS name, branch,
                workspace_path AS path, pinned_at AS pinnedAt, updated_at AS updatedAt,
                NULLIF(TRIM(workspace_name), '') AS customName,
                NULLIF(TRIM(pr_title), '') AS prTitle, state`;

  const toWorkspace = (
    row: Omit<ConductorWorkspace, "archived"> & { readonly state: string | null },
  ): ConductorWorkspace | null => {
    if ((row.state !== "ready" && row.state !== "archived") || !row.name || !row.path) return null;
    const { state, ...workspace } = row;
    return { ...workspace, archived: state === "archived" };
  };

  return {
    repos: () =>
      all<ConductorRepo>(
        `SELECT id, remote_url AS remoteUrl, root_path AS rootPath FROM repos WHERE id IS NOT NULL`,
      ),

    /** Workspaces Conductor still has checked out, newest first. */
    activeWorkspaces: (repoId: string): ReadonlyArray<ConductorWorkspace> =>
      all<Omit<ConductorWorkspace, "archived"> & { readonly state: string | null }>(
        `SELECT ${workspaceColumns}
         FROM workspaces
         WHERE repository_id = ? AND state = 'ready'
           AND directory_name IS NOT NULL AND workspace_path IS NOT NULL
         ORDER BY updated_at DESC`,
        repoId,
      ).flatMap((row) => {
        const workspace = toWorkspace(row);
        return workspace === null ? [] : [workspace];
      }),

    /** One workspace, active or archived, or `null` when the id is unknown. */
    workspace: (workspaceId: string): ConductorWorkspace | null => {
      const [row] = all<Omit<ConductorWorkspace, "archived"> & { readonly state: string | null }>(
        `SELECT ${workspaceColumns} FROM workspaces WHERE local_id = ?`,
        workspaceId,
      );
      return row === undefined ? null : toWorkspace(row);
    },

    /**
     * Archived workspaces that still have a sent prompt, newest first. The worktree is
     * usually deleted, so this does not check that the directory exists.
     */
    archivedWorkspaceIds: (repoId: string): ReadonlyArray<string> =>
      all<{ readonly id: string }>(
        `SELECT local_id AS id FROM workspaces AS workspace
         WHERE repository_id = ? AND state = 'archived'
           AND directory_name IS NOT NULL AND workspace_path IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM sessions AS session
             WHERE session.workspace_id = workspace.local_id
               AND COALESCE(session.is_hidden, 0) = 0
               AND COALESCE(session.agent_type, 'claude') IN ('claude', 'codex', 'cursor')
               AND EXISTS (
                 SELECT 1 FROM session_messages AS message
                 WHERE message.session_id = session.id AND message.role = 'user'
                   AND message.sent_at IS NOT NULL AND message.cancelled_at IS NULL
               )
           )
         ORDER BY updated_at DESC, local_id`,
        repoId,
      ).map((row) => row.id),

    /** A workspace's open tabs that have at least one sent prompt, in the order they opened. */
    tabs: (workspaceId: string): ReadonlyArray<ConductorTab> =>
      all<Omit<ConductorTab, "agent"> & { readonly agent: string | null }>(
        `SELECT sessions.id AS sessionId, sessions.workspace_id AS workspaceId,
                COALESCE(NULLIF(TRIM(sessions.title), ''), 'Untitled') AS title,
                sessions.agent_type AS agent, sessions.claude_session_id AS nativeSessionId,
                sessions.model, sessions.created_at AS createdAt,
                (SELECT COUNT(*) FROM session_messages AS messages
                 WHERE messages.session_id = sessions.id AND messages.role = 'user'
                   AND messages.sent_at IS NOT NULL AND messages.cancelled_at IS NULL
                ) AS userMessageCount
         FROM sessions
         WHERE sessions.workspace_id = ? AND COALESCE(sessions.is_hidden, 0) = 0
         ORDER BY sessions.created_at, sessions.id`,
        workspaceId,
      ).flatMap((tab) => {
        const agent = AGENTS.find((candidate) => candidate === (tab.agent ?? "claude"));
        return agent === undefined || tab.userMessageCount === 0 ? [] : [{ ...tab, agent }];
      }),

    /** A tab's sent messages in order; queued and cancelled prompts are left out. */
    messages: (sessionId: string) =>
      all<ConductorMessageRow>(
        `SELECT id, role, content, created_at AS createdAt FROM session_messages
         WHERE session_id = ? AND content IS NOT NULL AND cancelled_at IS NULL
           AND (role <> 'user' OR sent_at IS NOT NULL)
         ORDER BY created_at, rowid`,
        sessionId,
      ),

    /** Files and diff comments sent with a tab's prompts. */
    attachments: (sessionId: string) =>
      all<ConductorAttachmentRow>(
        `SELECT attachments.id, attachments.session_message_id AS messageId, attachments.type,
                COALESCE(attachments.original_name, 'attachment') AS name, attachments.path,
                comments.file_path AS commentFilePath, comments.line_number AS commentStartLine,
                comments.end_line_number AS commentEndLine, comments.body AS commentBody
         FROM attachments
         LEFT JOIN diff_comments AS comments ON comments.id = attachments.comment_id
         WHERE attachments.session_id = ? AND attachments.session_message_id IS NOT NULL
           AND COALESCE(attachments.is_draft, 0) = 0`,
        sessionId,
      ),

    close: () => db.close(),
  };
}

export type ConductorDatabase = ReturnType<typeof openConductorDatabase>;
