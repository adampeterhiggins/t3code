import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ASSISTANT_CITATION_MAX_TEXT_LENGTH = 8_000;
export const ASSISTANT_CITATION_MAX_COMMENT_LENGTH = 8_000;
export const ASSISTANT_CITATION_MAX_MARKDOWN_LENGTH = 16_000;
export const ASSISTANT_CITATION_CONTEXT_LENGTH = 32;
export const ASSISTANT_CITATION_MAX_SEGMENTS = 200;

/** One timeline item a transcript excerpt spans: a message, or a tool call's turn item. */
export const AssistantCitationSegment = Schema.Struct({
  kind: Schema.Literals(["user", "assistant", "tool"]),
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type AssistantCitationSegment = typeof AssistantCitationSegment.Type;

/**
 * A quote of rendered assistant text with an optional user comment.
 * Positions are UTF-16 offsets, not Markdown offsets. `markdown` is the same
 * selection as Markdown, kept only when it differs from `text`, so previews and
 * agents see its formatting; `text` stays the source of truth for locating it.
 *
 * With `segments` it quotes a stretch of the transcript instead: messages and
 * tool calls in timeline order, rendered into `text` and `markdown`. `messageId`
 * is then the first segment's id and the offsets cover the whole rendering.
 */
export const AssistantCitation = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentId.check(Schema.isMaxLength(512)),
  threadId: ThreadId.check(Schema.isMaxLength(512)),
  messageId: MessageId.check(Schema.isMaxLength(512)),
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  ),
  markdown: Schema.optional(
    Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(ASSISTANT_CITATION_MAX_MARKDOWN_LENGTH),
    ),
  ),
  comment: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_COMMENT_LENGTH)),
  ),
  start: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  end: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  segments: Schema.optional(
    Schema.Array(AssistantCitationSegment).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(ASSISTANT_CITATION_MAX_SEGMENTS),
    ),
  ),
}).check(
  Schema.makeFilter((citation) => citation.end > citation.start && citation.text.trim().length > 0),
);
export type AssistantCitation = typeof AssistantCitation.Type;
