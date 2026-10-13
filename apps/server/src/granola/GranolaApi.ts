import {
  GranolaError,
  parseGranolaNoteId,
  type GranolaGetNoteInput,
  type GranolaNoteContext,
  type GranolaNoteSummary,
  type GranolaSearchNotesInput,
  type GranolaSearchNotesResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/http/HttpClient";

import { GranolaAuth } from "./GranolaAuth.ts";
import { callGranolaTool, granolaNoteContext, parseGranolaMeetings } from "./granolaMcp.ts";

const RECENT_TTL_MS = 60_000;
const SUMMARY_CACHE_LIMIT = 500;

export class GranolaApi extends Context.Service<
  GranolaApi,
  {
    /** The last 30 days of meetings, filtered by title and participants. */
    readonly searchNotes: (
      input: GranolaSearchNotesInput,
    ) => Effect.Effect<GranolaSearchNotesResult, GranolaError>;
    readonly getNote: (
      input: GranolaGetNoteInput,
    ) => Effect.Effect<GranolaNoteContext, GranolaError>;
    /** The note's title and meeting without its content, read once per note while running. */
    readonly getNoteSummary: (
      input: GranolaGetNoteInput,
    ) => Effect.Effect<GranolaNoteSummary, GranolaError>;
  }
>()("t3/granola/GranolaApi") {}

const toSummary = (note: GranolaNoteSummary): GranolaNoteSummary => ({
  id: note.id,
  title: note.title,
  url: note.url,
  meetingAt: note.meetingAt,
  participants: note.participants,
  creator: note.creator,
});

/** @public Canonical Effect service construction. */
export const make = Effect.gen(function* () {
  const auth = yield* GranolaAuth;
  const client = yield* HttpClient.HttpClient;

  const callTool = Effect.fn("granola.api.call_tool")(function* (
    name: string,
    args: Record<string, unknown>,
  ) {
    const call = (token: string) =>
      callGranolaTool(client, token, name, args).pipe(
        Effect.mapError(
          () => new GranolaError({ reason: "api", detail: "Could not reach Granola." }),
        ),
      );
    const token = yield* auth.accessToken;
    let result = yield* call(token);
    if (result._tag === "Status" && result.status === 401)
      result = yield* call(yield* auth.refreshAccessToken(token));
    if (result._tag === "Ok") return result.text;
    if (result._tag === "ToolError")
      return yield* new GranolaError({ reason: "api", detail: result.message });
    if (result.status === 401) {
      yield* auth.markRevoked;
      return yield* new GranolaError({
        reason: "revoked",
        detail: "Reconnect Granola in Settings → Integrations.",
      });
    }
    if (result.status === 429)
      return yield* new GranolaError({
        reason: "rate-limited",
        detail: "Granola's rate limit was reached. Try again shortly.",
      });
    return yield* new GranolaError({
      reason: "api",
      detail: `Granola returned HTTP ${result.status}.`,
    });
  });

  // The picker filters as the user types; one listing per account serves every keystroke for a
  // minute. Failures are not kept, so connecting takes effect at once.
  const recentCache = yield* Ref.make<{
    readonly token: string;
    readonly at: number;
    readonly notes: ReadonlyArray<GranolaNoteSummary>;
  } | null>(null);
  const recent = Effect.gen(function* () {
    const token = yield* auth.accessToken;
    const now = yield* Clock.currentTimeMillis;
    const cached = yield* Ref.get(recentCache);
    if (cached !== null && cached.token === token && now - cached.at < RECENT_TTL_MS)
      return cached.notes;
    const notes = parseGranolaMeetings(
      yield* callTool("list_meetings", { time_range: "last_30_days" }),
    )
      .map(toSummary)
      .toSorted((a, b) => (b.meetingAt ?? "").localeCompare(a.meetingAt ?? ""));
    yield* Ref.set(recentCache, { token, at: now, notes });
    return notes;
  });

  const getNote = Effect.fn("granola.get_note")(function* (input: GranolaGetNoteInput) {
    const id = parseGranolaNoteId(input.id);
    if (id === null)
      return yield* new GranolaError({
        reason: "not-found",
        detail: "Use a Granola note link or meeting ID.",
      });
    const meeting = parseGranolaMeetings(yield* callTool("get_meetings", { meeting_ids: [id] })).at(
      0,
    );
    if (meeting === undefined)
      return yield* new GranolaError({
        reason: "not-found",
        detail:
          "Granola cannot read this note from the connected account. It may belong to another workspace.",
      });
    return granolaNoteContext(meeting);
  });

  // Bare note links in messages are named from this, so one read serves every render of a link.
  const summaries = new Map<string, GranolaNoteSummary>();
  const getNoteSummary = Effect.fn("granola.get_note_summary")(function* (
    input: GranolaGetNoteInput,
  ) {
    const id = parseGranolaNoteId(input.id);
    const cached = id === null ? undefined : summaries.get(id);
    if (cached !== undefined) return cached;
    const summary = toSummary(yield* getNote(input));
    if (summaries.size >= SUMMARY_CACHE_LIMIT) summaries.delete(summaries.keys().next().value!);
    if (id !== null) summaries.set(id, summary);
    return summary;
  });

  const searchNotes = Effect.fn("granola.search_notes")(function* (input: GranolaSearchNotesInput) {
    const query = input.query.trim();
    if (parseGranolaNoteId(query) !== null)
      return { notes: [toSummary(yield* getNote({ id: query }))] };
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const notes = yield* recent;
    return {
      notes: notes.filter((note) => {
        const haystack = `${note.title} ${note.participants.join(" ")}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }),
    };
  });

  return GranolaApi.of({ searchNotes, getNote, getNoteSummary });
});

export const layer = Layer.effect(GranolaApi, make);
