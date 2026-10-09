import {
  OrchestrationV2DispatchCommandResult,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/**
 * Deletes a thread as the user would from the sidebar. Served only on
 * `/mcp/operate`, to an agent holding an agent access token; an agent inside a
 * thread archives instead, so `/mcp` never lists it. Fork-only; see
 * docs/fork-differences.md.
 */
const ThreadDeleteTool = Tool.make("t3_thread_delete", {
  description:
    "Permanently delete a thread, as the user would in the app. Running work stops and pending requests are cancelled. This cannot be undone; prefer t3_thread_organize's archive, which can be reversed.",
  parameters: Schema.Struct({ threadId: ThreadId }),
  success: OrchestrationV2DispatchCommandResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Delete a thread")
  .annotate(Tool.Destructive, true);

export const ThreadDeleteToolkit = Toolkit.make(ThreadDeleteTool);
