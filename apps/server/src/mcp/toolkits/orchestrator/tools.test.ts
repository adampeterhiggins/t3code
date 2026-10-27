import { assert, describe, expect, it } from "@effect/vitest";
import { Tool } from "effect/ai";
import * as Schema from "effect/Schema";
import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";

import { OrchestratorToolkit } from "./tools.ts";
const {
  create_threads: CreateThreadsTool,
  delegate_task: DelegateTaskTool,
  schedule_task: ScheduleTaskTool,
  t3_thread_update: ThreadUpdateTool,
} = OrchestratorToolkit.tools;

describe("orchestrator MCP tool guidance", () => {
  it("directs subagent requests to delegation instead of ordinary threads", () => {
    assert.include(DelegateTaskTool.description ?? "", "Start one child agent");
    assert.include(CreateThreadsTool.description ?? "", "not delegation");
    assert.include(CreateThreadsTool.description ?? "", "call delegate_task");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "another provider's model");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Every new delegate review or re-check");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "never a `t3_thread_send`");
    // Subagents can get their own worktree without leaving the caller's lineage.
    assert.include(DelegateTaskTool.description ?? "", "workspaceStrategy");
    assert.include(
      OrchestratorToolkit.tools.orchestrator_capabilities.description ?? "",
      "use delegate_task with workspaceStrategy",
    );
    assert.property(
      (Tool.getJsonSchema(DelegateTaskTool) as { readonly properties?: object }).properties ?? {},
      "workspaceStrategy",
    );
    assert.include(
      OrchestratorToolkit.tools.t3_thread_send.description ?? "",
      "a requested follow-up creates a fresh task",
    );
    assert.include(
      OrchestratorToolkit.tools.task_cancel.description ?? "",
      "including later runs in its child thread",
    );
  });

  it("documents wait timeout as a parent budget, not a child failure", () => {
    const schema = Tool.getJsonSchema(DelegateTaskTool) as {
      readonly properties?: Readonly<
        Record<
          string,
          {
            readonly description?: unknown;
            readonly anyOf?: ReadonlyArray<{ readonly description?: unknown }>;
          }
        >
      >;
    };
    const mode = schema.properties?.mode;
    const timeoutMs = schema.properties?.timeoutMs;
    const modeText = [mode?.description, ...(mode?.anyOf ?? []).map((entry) => entry.description)]
      .filter((value) => typeof value === "string")
      .join(" ");
    const timeoutText = [
      timeoutMs?.description,
      ...(timeoutMs?.anyOf ?? []).map((entry) => entry.description),
    ]
      .filter((value) => typeof value === "string")
      .join(" ");
    assert.include(modeText, "Default 'async'");
    assert.include(timeoutText, "does not cancel the child");
  });

  it("publishes an actionable schedule schema and compatibility string branch", () => {
    const decode = Schema.decodeUnknownSync(ScheduleTaskTool.parametersSchema);
    const schedule = { type: "interval", everyMs: 60_000 } as const;
    assert.deepEqual(decode({ prompt: "Check upstream", schedule }).schedule, schedule);
    assert.deepEqual(
      decode({ prompt: "Check upstream", schedule: JSON.stringify(schedule) }).schedule,
      schedule,
    );
    const update = decode({ scheduledTaskId: "task-1", enabled: false });
    assert.equal(update.scheduledTaskId, "task-1");
    assert.isFalse(update.enabled);
    assert.include(ScheduleTaskTool.description ?? "", "`schedule` is an object, not text");
    assert.include(ScheduleTaskTool.description ?? "", "next run time");
  });

  it("publishes thread metadata actions from an object-root schema", () => {
    const schema = Tool.getJsonSchema(ThreadUpdateTool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
    };

    assert.equal(schema.type, "object");
    assert.hasAllKeys(schema.properties ?? {}, ["threadId", "action", "title", "clientRequestId"]);
    assert.include(ThreadUpdateTool.description ?? "", "Workspace and branch cannot change here");
  });
});

// Oversized page sizes clamp on decode, so the schema has no `maximum`; Codex also drops
// bounds from its TypeScript view. The description is the only place a model sees a limit.
it("states t3_thread_read page size limits in the parameter descriptions", () => {
  const schema = Tool.getJsonSchema(OrchestratorToolkit.tools.t3_thread_read) as {
    readonly properties: Readonly<Record<string, { readonly description?: string }>>;
  };
  const limits = { limit: "100", runLimit: "50", maxCharsPerItem: "50000" };
  for (const [name, maximum] of Object.entries(limits)) {
    expect(schema.properties[name]?.description, name).toContain(maximum);
  }
});
