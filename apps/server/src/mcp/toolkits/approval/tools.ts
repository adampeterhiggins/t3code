import {
  OrchestrationV2DispatchCommandResult,
  OrchestratorMcpFailure,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** Only an agent access token acting as the user may answer another thread's approval. */
const ApprovalRespondTool = Tool.make("t3_approval_respond", {
  description:
    "Approve or decline a permission request a thread is waiting on, as the user would in the app. get_thread lists a thread's pendingApprovals with their requestId, kind, and prompt. decision is accept, acceptForSession, acceptAlways, decline, or cancel; when the request advertises options, use one of them. Questions are answered with t3_pending_request_respond instead.",
  parameters: Schema.Struct({
    threadId: ThreadId,
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  }),
  success: OrchestrationV2DispatchCommandResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SecureRandom.SecureRandom,
  ],
})
  .annotate(Tool.Title, "Answer a thread's approval")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const ApprovalToolkit = Toolkit.make(ApprovalRespondTool);
