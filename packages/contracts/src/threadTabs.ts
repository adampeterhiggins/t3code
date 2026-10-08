import * as Schema from "effect/Schema";
import { MessageId, RunId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2CreationSource } from "./orchestrationV2.ts";

export const ThreadTab = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
});
export type ThreadTab = typeof ThreadTab.Type;

export const ThreadTabGroup = Schema.Struct({
  groupId: ThreadId,
  name: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  tabs: Schema.Array(ThreadTab),
});
export type ThreadTabGroup = typeof ThreadTabGroup.Type;

export const SetThreadTabGroupNameInput = Schema.Struct({
  name: Schema.NullOr(TrimmedNonEmptyString),
});
export type SetThreadTabGroupNameInput = typeof SetThreadTabGroupNameInput.Type;

export const ThreadTabMembership = Schema.Struct({
  threadId: ThreadId,
  groupId: ThreadId,
  groupName: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ThreadTabMembership = typeof ThreadTabMembership.Type;

export const ThreadTabMemberships = Schema.Array(ThreadTabMembership);
export type ThreadTabMemberships = typeof ThreadTabMemberships.Type;

export const CreateThreadTabInput = Schema.Struct({
  threadId: ThreadId,
  modelSelection: ModelSelection,
  /** The surface that opened the tab; defaults to web. */
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type CreateThreadTabInput = typeof CreateThreadTabInput.Type;

/**
 * Forks a chat into a new tab: a native `thread.fork` of `sourceThreadId` at `runId`, joined to
 * the group of the thread in the path. The source differs from that thread when the response was
 * inherited from an earlier fork.
 */
export const ForkThreadTabInput = Schema.Struct({
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  runId: RunId,
  title: Schema.optional(TrimmedNonEmptyString),
  /**
   * The new tab's model when it differs from the source's. It is set before the tab's first
   * message, which then carries the conversation over to that model's provider.
   */
  modelSelection: Schema.optional(ModelSelection),
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type ForkThreadTabInput = typeof ForkThreadTabInput.Type;

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
