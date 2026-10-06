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
  readonly updatedAt: string;
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
  readonly role: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface ConductorTranscriptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
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

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Conductor stores every agent's output as Claude Agent SDK messages. Keeps the prompts and
 * the top-level reply text; tool calls, tool results and subagent output are dropped, so the
 * replies between two prompts merge into one message.
 */
export function parseConductorTranscript(
  rows: ReadonlyArray<ConductorMessageRow>,
): ConductorTranscript {
  const messages: Array<ConductorTranscriptMessage> = [];
  let model: string | null = null;
  for (const row of rows) {
    if (row.role === "user") {
      const text = row.content.trim();
      if (text !== "") {
        messages.push({ role: "user", text, createdAt: conductorIsoTime(row.createdAt) });
      }
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

  return {
    repos: () =>
      all<ConductorRepo>(
        `SELECT id, remote_url AS remoteUrl, root_path AS rootPath FROM repos WHERE id IS NOT NULL`,
      ),

    /** Workspaces Conductor still has checked out, newest first. */
    activeWorkspaces: (repoId: string) =>
      all<ConductorWorkspace>(
        `SELECT local_id AS id, repository_id AS repoId, directory_name AS name, branch,
                workspace_path AS path, pinned_at AS pinnedAt, updated_at AS updatedAt
         FROM workspaces
         WHERE repository_id = ? AND state = 'ready'
           AND directory_name IS NOT NULL AND workspace_path IS NOT NULL
         ORDER BY updated_at DESC`,
        repoId,
      ),

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
        `SELECT role, content, created_at AS createdAt FROM session_messages
         WHERE session_id = ? AND content IS NOT NULL AND cancelled_at IS NULL
           AND (role <> 'user' OR sent_at IS NOT NULL)
         ORDER BY created_at, rowid`,
        sessionId,
      ),

    close: () => db.close(),
  };
}

export type ConductorDatabase = ReturnType<typeof openConductorDatabase>;
