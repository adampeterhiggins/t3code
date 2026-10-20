import {
  MessageDraft,
  MessageDraftError,
  MessageDraftId,
  MessageDraftSendMode,
  MessageDraftSendResult,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { McpAttachmentInput } from "../attachment/input.ts";

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, MessageDraftError]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const DRAFTS =
  "A draft is a message saved in a thread for the user to review, edit, and send later; it appears above the thread's composer in every T3 Code client.";

const draftThreadId = Schema.optional(
  ThreadId.annotate({ description: "Thread the draft belongs to. Omit for this thread." }),
);

const DraftListTool = Tool.make("t3_draft_list", {
  ...shared,
  description: `List message drafts, newest first. ${DRAFTS} Omit threadId to list every thread's drafts.`,
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Only this thread's drafts. Omit for every thread." }),
    ),
  }),
  success: Schema.Struct({ drafts: Schema.Array(MessageDraft) }),
})
  .annotate(Tool.Title, "List message drafts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DraftCreateTool = Tool.make("t3_draft_create", {
  ...shared,
  description: `Save a message as a draft in a thread without sending it. ${DRAFTS} Use it to prepare a message the user should check before it reaches the thread's agent. To attach files, upload each with t3_attachment_prepare_upload first and pass its metadata and returned id.`,
  parameters: Schema.Struct({
    threadId: draftThreadId,
    text: Schema.String.check(Schema.isMaxLength(120000)),
    attachments: Schema.optional(
      Schema.Array(McpAttachmentInput).check(Schema.isMaxLength(8)).annotate({
        description: "Pending uploads from t3_attachment_prepare_upload.",
      }),
    ),
  }),
  success: MessageDraft,
})
  .annotate(Tool.Title, "Save message draft")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const DraftSendTool = Tool.make("t3_draft_send", {
  ...shared,
  description: `Send a draft to its thread's agent and remove it. ${DRAFTS} Only send when the user asked for it. mode auto (default) steers an active turn or starts one, queue waits for the active turn, steer requires an active turn. The target cannot have broader permission modes than the caller.`,
  parameters: Schema.Struct({
    draftId: MessageDraftId,
    threadId: draftThreadId,
    mode: Schema.optional(MessageDraftSendMode),
  }),
  success: MessageDraftSendResult,
})
  .annotate(Tool.Title, "Send message draft")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const DraftDeleteTool = Tool.make("t3_draft_delete", {
  ...shared,
  description: `Delete a draft without sending it. ${DRAFTS}`,
  parameters: Schema.Struct({ draftId: MessageDraftId, threadId: draftThreadId }),
  success: Schema.Struct({}),
})
  .annotate(Tool.Title, "Delete message draft")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const MessageDraftsToolkit = Toolkit.make(
  DraftListTool,
  DraftCreateTool,
  DraftSendTool,
  DraftDeleteTool,
);
