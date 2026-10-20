import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import { OrchestrationMessageContext } from "./composerContext.ts";

export const MessageDraftId = TrimmedNonEmptyString.pipe(Schema.brand("MessageDraftId"));
export type MessageDraftId = typeof MessageDraftId.Type;

export const MessageDraftOrigin = Schema.Literals(["web", "desktop", "mobile", "agent"]);
export type MessageDraftOrigin = typeof MessageDraftOrigin.Type;

/**
 * A message saved in a thread to send later. Drafts live on the server so every client of the
 * environment, and agents over MCP, see the same list. Attachments are claimed into the thread
 * when the draft is saved, so they outlive the pending-upload sweep.
 */
export const MessageDraft = Schema.Struct({
  id: MessageDraftId,
  threadId: ThreadId,
  text: Schema.String,
  attachments: Schema.Array(ChatAttachment),
  context: Schema.optional(OrchestrationMessageContext),
  origin: MessageDraftOrigin,
  createdAt: IsoDateTime,
});
export type MessageDraft = typeof MessageDraft.Type;

/** Every draft in the environment, newest first. */
export const MessageDrafts = Schema.Array(MessageDraft);
export type MessageDrafts = typeof MessageDrafts.Type;

export const MessageDraftSaveInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  /** Pending upload ids or attachments the thread already owns. */
  attachments: Schema.Array(ChatAttachment),
  context: Schema.optional(OrchestrationMessageContext),
  origin: MessageDraftOrigin,
});
export type MessageDraftSaveInput = typeof MessageDraftSaveInput.Type;

export const MessageDraftRefInput = Schema.Struct({ draftId: MessageDraftId });
export type MessageDraftRefInput = typeof MessageDraftRefInput.Type;

export const MessageDraftSendMode = Schema.Literals(["auto", "queue", "steer"]);
export type MessageDraftSendMode = typeof MessageDraftSendMode.Type;

export const MessageDraftSendInput = Schema.Struct({
  draftId: MessageDraftId,
  mode: MessageDraftSendMode,
});
export type MessageDraftSendInput = typeof MessageDraftSendInput.Type;

export const MessageDraftSendResult = Schema.Struct({
  threadId: ThreadId,
  messageId: TrimmedNonEmptyString,
});
export type MessageDraftSendResult = typeof MessageDraftSendResult.Type;

export const MessageDraftErrorReason = Schema.Literals([
  /** Already opened, sent, or deleted, possibly from another device. */
  "not-found",
  "thread-not-found",
  "invalid-attachment",
  "empty",
  "send-failed",
]);
export type MessageDraftErrorReason = typeof MessageDraftErrorReason.Type;

export class MessageDraftError extends Schema.TaggedError<MessageDraftError>()(
  "MessageDraftError",
  {
    reason: MessageDraftErrorReason,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export function messageDraftsForThread(
  drafts: ReadonlyArray<MessageDraft> | undefined,
  threadId: ThreadId,
): ReadonlyArray<MessageDraft> {
  return drafts?.filter((draft) => draft.threadId === threadId) ?? [];
}
