import {
  OrchestrationV2DispatchCommandResult,
  OrchestratorMcpFailure,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/**
 * Answers another thread's permission request. Served only on `/mcp/operate`,
 * to an agent holding an agent access token, which acts as the user. Upstream's
 * t3_pending_request_respond answers questions but refuses approvals, and an
 * agent inside a thread never answers another thread's approvals: those come
 * to the user. Fork-only; see docs/fork-differences.md.
 */
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
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Answer a thread's approval")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const ApprovalToolkit = Toolkit.make(ApprovalRespondTool);
