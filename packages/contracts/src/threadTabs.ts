import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

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
});
export type ThreadTabHandoffInput = typeof ThreadTabHandoffInput.Type;

export const ThreadTabHandoff = Schema.Struct({ text: Schema.String });
export type ThreadTabHandoff = typeof ThreadTabHandoff.Type;
