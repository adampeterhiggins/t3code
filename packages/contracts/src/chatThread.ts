import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";

/** Most messages a Slack or Discord snapshot carries; both services read at most 200 replies. */
const CHAT_THREAD_MESSAGES_MAX = 256;

/**
 * One message of a Slack or Discord snapshot, for clients to draw the thread as a conversation.
 * The agent reads the snapshot's markdown instead; both hold the same messages.
 */
export const ChatThreadMessage = Schema.Struct({
  /** Where it sits in the thread, 0 being the parent. A jump means messages left out to fit. */
  index: NonNegativeInt,
  authorName: Schema.String.check(Schema.isMaxLength(2_048)),
  avatarUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048))),
  postedAt: IsoDateTime,
  /** Markdown. */
  text: Schema.String.check(Schema.isMaxLength(32_000)),
  files: Schema.Array(Schema.String.check(Schema.isMaxLength(2_048))).check(
    Schema.isMaxLength(100),
  ),
  /** The message the link pointed at. */
  linked: Schema.Boolean,
});
export type ChatThreadMessage = typeof ChatThreadMessage.Type;

export const ChatThreadMessages = Schema.Array(ChatThreadMessage).check(
  Schema.isMaxLength(CHAT_THREAD_MESSAGES_MAX),
);
