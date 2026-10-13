import {
  GRANOLA_NOTE_MARKDOWN_MAX_CHARS,
  type GranolaNoteContext,
  type GranolaNoteSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * Granola has no public API for every plan, so T3 Code reads notes through Granola's MCP server
 * (the one Claude and ChatGPT connect to), over plain JSON-RPC on Streamable HTTP.
 */
export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";
const PROTOCOL_VERSION = "2025-06-18";

const JsonRpcReply = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String, Schema.Null])),
  result: Schema.optional(
    Schema.Struct({
      content: Schema.optional(
        Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
      ),
      isError: Schema.optional(Schema.Boolean),
    }),
  ),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});
type JsonRpcReply = typeof JsonRpcReply.Type;
const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(JsonRpcReply));

/** The reply with `id`, from a JSON body or the `data:` lines of an event stream. */
export function readJsonRpcReply(body: string, id: number): JsonRpcReply | null {
  const candidates = body.trimStart().startsWith("{")
    ? [body]
    : body
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
  for (const candidate of candidates) {
    const reply = decodeReply(candidate);
    if (reply._tag === "Some" && reply.value.id === id) return reply.value;
  }
  return null;
}

export type GranolaToolResult =
  | { readonly _tag: "Ok"; readonly text: string }
  | { readonly _tag: "Status"; readonly status: number }
  | { readonly _tag: "ToolError"; readonly message: string };

/**
 * Opens a session, calls one tool, and returns its text. HTTP failures come back as their status
 * so callers can refresh a rejected token and retry.
 */
export const callGranolaTool = Effect.fn("granola.mcp.call_tool")(function* (
  client: HttpClient.HttpClient,
  token: string,
  name: string,
  args: Record<string, unknown>,
) {
  const post = (body: Record<string, unknown>, sessionId: string | undefined) =>
    HttpClientRequest.post(GRANOLA_MCP_URL).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("Accept", "application/json, text/event-stream"),
      HttpClientRequest.setHeader("MCP-Protocol-Version", PROTOCOL_VERSION),
      sessionId === undefined
        ? (request) => request
        : HttpClientRequest.setHeader("Mcp-Session-Id", sessionId),
      HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", ...body }),
      client.execute,
    );
  const initialized = yield* post(
    {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "T3 Code", version: "1.0.0" },
      },
    },
    undefined,
  );
  if (initialized.status < 200 || initialized.status >= 300)
    return { _tag: "Status", status: initialized.status } as GranolaToolResult;
  const sessionId = initialized.headers["mcp-session-id"];
  // Drain the reply so the connection is released before the next request.
  yield* initialized.text;
  yield* post({ method: "notifications/initialized" }, sessionId).pipe(
    Effect.flatMap((response) => response.text),
  );
  const called = yield* post(
    { id: 2, method: "tools/call", params: { name, arguments: args } },
    sessionId,
  );
  if (called.status < 200 || called.status >= 300)
    return { _tag: "Status", status: called.status } as GranolaToolResult;
  const reply = readJsonRpcReply(yield* called.text, 2);
  if (reply === null) return { _tag: "ToolError", message: "Granola returned no reply." } as const;
  if (reply.error) return { _tag: "ToolError", message: reply.error.message } as const;
  const text = (reply.result?.content ?? [])
    .flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []))
    .join("\n");
  return reply.result?.isError
    ? ({ _tag: "ToolError", message: text || "Granola could not run the request." } as const)
    : ({ _tag: "Ok", text } as const);
});

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

interface GranolaMeeting extends GranolaNoteSummary {
  /** The meeting's sections other than participants, such as `summary` and `private_notes`. */
  readonly sections: ReadonlyArray<{ readonly tag: string; readonly text: string }>;
  readonly date: string | null;
  /** Participants as Granola describes them, with companies but without email addresses. */
  readonly participantsText: string;
}

/**
 * Granola lists participants as `Ada Lovelace (note creator) from Acme <ada@acme.com>, …`. Names
 * come without the role, company, and address; the description keeps the company for agents.
 */
export function readParticipants(value: string) {
  const text = value
    .replace(/\s*<[^>]*>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  let creator: string | null = null;
  const names = text.split(/\s*,\s*/u).flatMap((entry) => {
    const name = entry
      .replace(/\s*\(note creator\)/u, "")
      .replace(/\s+from\s+.*$/u, "")
      .trim();
    if (name && entry.includes("(note creator)")) creator = name;
    return name ? [name] : [];
  });
  return { text, names: [...new Set(names)], creator: creator as string | null };
}

/** The `<meeting>` elements Granola's `list_meetings` and `get_meetings` tools reply with. */
export function parseGranolaMeetings(text: string): ReadonlyArray<GranolaMeeting> {
  const meetings: Array<GranolaMeeting> = [];
  for (const match of text.matchAll(/<meeting\s([^>]*)>([\s\S]*?)<\/meeting>/gu)) {
    const attributes = new Map(
      Array.from(match[1]!.matchAll(/([a-z_]+)="([^"]*)"/gu), (attribute) => [
        attribute[1]!,
        unescapeXml(attribute[2]!),
      ]),
    );
    const id = attributes.get("id");
    if (!id) continue;
    const sections: Array<{ tag: string; text: string }> = [];
    let participants = readParticipants("");
    for (const section of match[2]!.matchAll(/<([a-z_]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gu)) {
      const content = unescapeXml(section[2]!).trim();
      if (section[1] === "known_participants") participants = readParticipants(content);
      else if (content && section[1] !== "attachments")
        sections.push({ tag: section[1]!, text: content });
    }
    meetings.push({
      id,
      title: attributes.get("title")?.trim() || "Untitled meeting",
      url: attributes.get("url") ?? `https://notes.granola.ai/d/${id}`,
      meetingAt: attributes.get("meeting_at") ?? attributes.get("created_at") ?? null,
      participants: participants.names,
      creator: participants.creator,
      participantsText: participants.text,
      date: attributes.get("date") ?? null,
      sections,
    });
  }
  return meetings;
}

const SECTION_TITLES: Record<string, string> = {
  summary: "Summary",
  private_notes: "Notes",
  notes: "Notes",
};
function sectionTitle(tag: string): string {
  const words = tag.replaceAll("_", " ");
  return SECTION_TITLES[tag] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

/** The note as the capped markdown snapshot attached to a message. */
export function granolaNoteContext(meeting: GranolaMeeting): GranolaNoteContext {
  const header = [
    `# ${meeting.title}`,
    ...(meeting.date ? [`Date: ${meeting.date}`] : []),
    ...(meeting.participantsText ? [`Participants: ${meeting.participantsText}`] : []),
  ].join("\n");
  const body = meeting.sections.map(
    (section) => `## ${sectionTitle(section.tag)}\n\n${section.text}`,
  );
  const markdown = [header, ...(body.length > 0 ? body : ["_This note has no summary yet._"])].join(
    "\n\n",
  );
  const note = "\n\n[Granola note content is truncated.]";
  return {
    id: meeting.id,
    title: meeting.title,
    url: meeting.url,
    meetingAt: meeting.meetingAt,
    participants: meeting.participants,
    creator: meeting.creator,
    markdown:
      markdown.length > GRANOLA_NOTE_MARKDOWN_MAX_CHARS
        ? markdown.slice(0, GRANOLA_NOTE_MARKDOWN_MAX_CHARS - note.length) + note
        : markdown,
  };
}
