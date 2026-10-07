import { ProviderInstanceId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  modelChangeSourceSelection,
  modelChangeTurnItem,
  pendingModelChangeProjection,
} from "./modelChangeMarker.ts";

const threadId = ThreadId.make("thread:model-change");
const now = DateTime.makeUnsafe("2026-10-07T00:00:00.000Z");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

function run(
  ordinal: number,
  model: string,
  status: "completed" | "queued" | "running" | "rolled_back" = "completed",
  instanceId = codex,
) {
  return {
    status,
    ordinal,
    startedAt: now,
    completedAt: status === "running" || status === "queued" ? null : now,
    modelSelection: { instanceId, model },
  };
}

describe("modelChangeTurnItem", () => {
  it("records a model switch and ignores an unchanged model", () => {
    const changed = modelChangeTurnItem({
      id: TurnItemId.make("turn-item:model-change"),
      threadId,
      runId: RunId.make("run:2"),
      nodeId: null,
      providerThreadId: null,
      ordinal: 1,
      from: { instanceId: codex, model: "gpt-5.4" },
      to: { instanceId: codex, model: "gpt-5.6" },
      now,
    });
    expect(changed?.type).toBe("model_change");
    expect(changed?.from.model).toBe("gpt-5.4");
    expect(changed?.to.model).toBe("gpt-5.6");
    expect(
      modelChangeTurnItem({
        id: TurnItemId.make("turn-item:same"),
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        ordinal: 1,
        from: { instanceId: codex, model: "gpt-5.4", options: [{ id: "effort", value: "low" }] },
        to: { instanceId: codex, model: "gpt-5.4", options: [{ id: "effort", value: "high" }] },
        now,
      }),
    ).toBeNull();
  });

  it("uses the latest started run, not a queued one", () => {
    expect(
      modelChangeSourceSelection([
        run(1, "gpt-5.4"),
        run(2, "gpt-5.6", "queued"),
        run(0, "old", "rolled_back"),
      ])?.model,
    ).toBe("gpt-5.4");
  });

  it("shows a pending divider only until the thread is already on that model", () => {
    const pending = pendingModelChangeProjection({
      threadId,
      draft: { instanceId: claude, model: "claude-opus" },
      runs: [run(1, "gpt-5.4")],
      now,
    });
    expect(pending?.item.type).toBe("model_change");
    expect(pending?.visibility).toBe("synthetic");
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: { instanceId: codex, model: "gpt-5.4" },
        runs: [run(1, "gpt-5.4", "running")],
        now,
      }),
    ).toBeNull();
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: { instanceId: codex, model: "gpt-5.6" },
        runs: [],
        now,
      }),
    ).toBeNull();
  });
});
