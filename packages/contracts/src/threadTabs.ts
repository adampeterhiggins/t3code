import * as Schema from "effect/Schema";
import { MessageId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const ThreadTab = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
});
export type ThreadTab = typeof ThreadTab.Type;

export const ThreadTabGroup = Schema.Struct({
  groupId: ThreadId,
  tabs: Schema.Array(ThreadTab),
});
export type ThreadTabGroup = typeof ThreadTabGroup.Type;

export const ThreadTabMembership = Schema.Struct({
  threadId: ThreadId,
  groupId: ThreadId,
});
export type ThreadTabMembership = typeof ThreadTabMembership.Type;

export const ThreadTabMemberships = Schema.Array(ThreadTabMembership);
export type ThreadTabMemberships = typeof ThreadTabMemberships.Type;

export const CreateThreadTabInput = Schema.Struct({
  threadId: ThreadId,
  modelSelection: ModelSelection,
});
export type CreateThreadTabInput = typeof CreateThreadTabInput.Type;

export const ThreadTabHandoffInput = Schema.Struct({
  sourceThreadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(8)),
  /** Forking: summarize only what came before this user message of the single source. */
  beforeMessageId: Schema.optional(MessageId),
  /** Forking: summarize through this completed assistant message of the single source. */
  afterMessageId: Schema.optional(MessageId),
});
export type ThreadTabHandoffInput = typeof ThreadTabHandoffInput.Type;

export const ThreadTabHandoff = Schema.Struct({ text: Schema.String });
export type ThreadTabHandoff = typeof ThreadTabHandoff.Type;
