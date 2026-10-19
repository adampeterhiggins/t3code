// @effect-diagnostics nodeBuiltinImport:off
/**
 * A member agent never becomes a provider task and emits nothing on the event
 * stream, so the transcript the harness writes is the only record of its tool
 * calls. Reads start from a byte offset and return only the lines added since
 * the last snapshot, which is what triggers the next read.
 */
import * as NodePath from "node:path";

import { OrchestrationWorkflowFileError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { field, text } from "./unknownField.ts";
import { readContainedWorkflowFile } from "./workflowFileRead.ts";

const TRANSCRIPT_BYTE_CAP = 256 * 1024;

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type WorkflowAgentTranscriptItem =
  | { readonly type: "text"; readonly id: string; readonly text: string }
  | { readonly type: "thinking"; readonly id: string; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: "tool_result";
      readonly id: string;
      readonly isError: boolean;
      readonly output: unknown;
    };

export interface WorkflowAgentTranscriptCursor {
  readonly offset: number;
  readonly remainder: string;
  readonly discarding: boolean;
  readonly answerText: Readonly<Record<string, string>>;
}

export const emptyWorkflowAgentTranscriptCursor = {
  offset: 0,
  remainder: "",
  discarding: false,
  answerText: {},
} satisfies WorkflowAgentTranscriptCursor;

export interface WorkflowAgentTranscriptBatch {
  readonly items: ReadonlyArray<WorkflowAgentTranscriptItem>;
  readonly cursor: WorkflowAgentTranscriptCursor;
  readonly behind: boolean;
  readonly missing: boolean;
}

function transcriptToolOutput(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content ?? "";
  const parts: string[] = [];
  let sawImage = false;
  for (const block of content) {
    if (typeof block === "string") {
      if (block.length > 0) parts.push(block);
      continue;
    }
    const type = text(field(block, "type"));
    if (type === "text") {
      const value = field(block, "text");
      if (typeof value === "string" && value.length > 0) parts.push(value);
    } else if (type === "image") {
      sawImage = true;
    }
  }
  if (parts.length === 0 && sawImage) return "[image]";
  return parts.length === 0 ? content : parts.join("\n");
}

/**
 * One assistant message is split across several lines that share `message.id`,
 * so later text updates that same turn. Attachment lines, meta lines and the
 * member's own prompt are harness bookkeeping.
 */
export function parseWorkflowAgentTranscript(input: {
  readonly contents: string;
  readonly answerText?: Readonly<Record<string, string>> | undefined;
  readonly discarding?: boolean | undefined;
  readonly atEof?: boolean | undefined;
}): {
  readonly items: ReadonlyArray<WorkflowAgentTranscriptItem>;
  readonly remainder: string;
  readonly discarding: boolean;
  readonly answerText: Readonly<Record<string, string>>;
} {
  const answerText: Record<string, string> = { ...(input.answerText ?? {}) };
  let body = input.contents;
  if (input.discarding === true) {
    const newline = body.indexOf("\n");
    if (newline < 0) {
      return { items: [], remainder: "", discarding: true, answerText };
    }
    body = body.slice(newline + 1);
  }

  const atEof = input.atEof === true;
  const endsWithNewline = body.endsWith("\n");
  const lines = body.length === 0 ? [] : body.split("\n");
  if (endsWithNewline) lines.pop();
  let remainder = "";
  if (!endsWithNewline && lines.length > 0) {
    const tail = lines.pop() ?? "";
    if (!atEof) {
      remainder = tail;
    } else {
      try {
        JSON.parse(tail);
        lines.push(tail);
      } catch {
        remainder = tail;
      }
    }
  }

  const items: WorkflowAgentTranscriptItem[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (field(entry, "isMeta") === true) continue;
    const entryType = text(field(entry, "type"));
    if (entryType === "attachment") continue;
    const message = field(entry, "message");
    const content = field(message, "content");
    const messageId = text(field(message, "id"));
    const lineId = text(field(entry, "uuid")) ?? messageId;

    if (entryType === "user") {
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (text(field(block, "type")) !== "tool_result") continue;
        const id = text(field(block, "tool_use_id"));
        if (id === undefined) continue;
        items.push({
          type: "tool_result",
          id,
          isError: field(block, "is_error") === true,
          output: transcriptToolOutput(field(block, "content")),
        });
      }
      continue;
    }
    if (entryType !== "assistant" || !Array.isArray(content)) continue;

    let thinkingIndex = 0;
    for (const block of content) {
      const blockType = text(field(block, "type"));
      if (blockType === "thinking") {
        const thinking = text(field(block, "thinking"));
        if (thinking === undefined || lineId === undefined) continue;
        items.push({
          type: "thinking",
          id: `${lineId}:thinking:${thinkingIndex}`,
          text: thinking,
        });
        thinkingIndex += 1;
        continue;
      }
      if (blockType === "tool_use") {
        const id = text(field(block, "id"));
        const name = text(field(block, "name"));
        if (id === undefined || name === undefined) continue;
        items.push({ type: "tool_use", id, name, input: field(block, "input") ?? {} });
        continue;
      }
      if (blockType !== "text") continue;
      const value = field(block, "text");
      const id = messageId ?? lineId;
      if (typeof value !== "string" || value.trim().length === 0 || id === undefined) continue;
      const prior = answerText[id];
      const next = prior === undefined || prior.length === 0 ? value : `${prior}\n\n${value}`;
      answerText[id] = next;
      items.push({ type: "text", id, text: next });
    }
  }

  return { items, remainder, discarding: false, answerText };
}

export const readWorkflowAgentTranscript = Effect.fn("orchestration.readWorkflowAgentTranscript")(
  function* (input: {
    readonly transcriptDir: string;
    readonly agentId: string;
    readonly configDir?: string;
    readonly cursor: WorkflowAgentTranscriptCursor;
  }) {
    if (!AGENT_ID_PATTERN.test(input.agentId)) {
      return yield* new OrchestrationWorkflowFileError({
        reason: "invalid-path",
        path: input.agentId,
      });
    }
    let cursor = input.cursor;
    const readAt = (offset: number) =>
      readContainedWorkflowFile({
        path: NodePath.join(input.transcriptDir, `agent-${input.agentId}.jsonl`),
        extension: ".jsonl",
        byteCap: TRANSCRIPT_BYTE_CAP,
        start: offset,
        ...(input.configDir === undefined ? {} : { configDir: input.configDir }),
      }).pipe(
        Effect.catchTag("OrchestrationWorkflowFileError", (error) =>
          error.reason === "not-found" ? Effect.succeed(null) : Effect.fail(error),
        ),
      );
    let file = yield* readAt(cursor.offset);
    if (file === null) {
      return {
        items: [],
        cursor,
        behind: false,
        missing: true,
      } satisfies WorkflowAgentTranscriptBatch;
    }
    // A retry rewrites the file in place. Start over so the new attempt is read.
    if (file.size < cursor.offset) {
      cursor = emptyWorkflowAgentTranscriptCursor;
      file = yield* readAt(0);
      if (file === null) {
        return {
          items: [],
          cursor,
          behind: false,
          missing: true,
        } satisfies WorkflowAgentTranscriptBatch;
      }
    }
    const discardChunk = file.truncated && !file.contents.includes("\n");
    if (discardChunk) {
      return {
        items: [],
        cursor: {
          ...cursor,
          offset: cursor.offset + file.bytesRead,
          remainder: "",
          discarding: true,
        },
        behind: true,
        missing: false,
      };
    }
    const parsed = parseWorkflowAgentTranscript({
      contents: cursor.remainder + file.contents,
      answerText: cursor.answerText,
      discarding: cursor.discarding,
      atEof: !file.truncated,
    });
    return {
      items: parsed.items,
      cursor: {
        offset: cursor.offset + file.bytesRead,
        remainder: parsed.remainder,
        discarding: parsed.discarding,
        answerText: parsed.answerText,
      },
      behind: file.truncated || parsed.discarding,
      missing: false,
    };
  },
);
