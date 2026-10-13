import {
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  formatModelOptionChanges,
  modelChangeSourceSelection,
  modelChangeTurnItem,
  modelOptionChanges,
  pendingModelChangeProjection,
} from "./modelChangeMarker.ts";

const threadId = ThreadId.make("thread:model-change");
const now = DateTime.makeUnsafe("2026-10-07T00:00:00.000Z");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

const provider = {
  instanceId: codex,
  models: [
    {
      slug: "gpt-5.4",
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select" as const,
            options: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium", isDefault: true },
              { id: "high", label: "High" },
              { id: "ultrathink", label: "Ultrathink" },
            ],
            promptInjectedValues: ["ultrathink"],
          },
          { id: "fastMode", label: "Fast Mode", type: "boolean" as const },
        ],
      },
    },
  ],
} as unknown as ServerProvider;

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
  it("records a model switch and ignores an unchanged selection", () => {
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
        to: { instanceId: codex, model: "gpt-5.4", options: [{ id: "effort", value: "low" }] },
        now,
      }),
    ).toBeNull();
  });

  it("records an option change on the same model", () => {
    const changed = modelChangeTurnItem({
      id: TurnItemId.make("turn-item:options"),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      ordinal: 1,
      from: { instanceId: codex, model: "gpt-5.4", options: [{ id: "effort", value: "low" }] },
      to: { instanceId: codex, model: "gpt-5.4", options: [{ id: "effort", value: "high" }] },
      now,
    });
    expect(changed?.title).toBe("Model settings changed");
    expect(changed?.to.options).toEqual([{ id: "effort", value: "high" }]);
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
      providers: [],
      now,
    });
    expect(pending?.item.type).toBe("model_change");
    expect(pending?.visibility).toBe("synthetic");
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: { instanceId: codex, model: "gpt-5.4" },
        runs: [run(1, "gpt-5.4", "running")],
        providers: [],
        now,
      }),
    ).toBeNull();
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: { instanceId: codex, model: "gpt-5.6" },
        runs: [],
        providers: [],
        now,
      }),
    ).toBeNull();
  });

  it("ignores pending options that dispatch as the default", () => {
    const providers = [provider];
    const explicitDefault = {
      instanceId: codex,
      model: "gpt-5.4",
      options: [{ id: "effort", value: "medium" }],
    };
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: explicitDefault,
        runs: [run(1, "gpt-5.4")],
        providers,
        now,
      }),
    ).toBeNull();
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: { ...explicitDefault, options: [{ id: "effort", value: "ultrathink" }] },
        runs: [run(1, "gpt-5.4")],
        providers,
        now,
      }),
    ).toBeNull();
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: { ...explicitDefault, options: [{ id: "fastMode", value: true }] },
        runs: [run(1, "gpt-5.4")],
        providers,
        now,
      })?.item.title,
    ).toBe("Model settings changed");
  });
});

describe("modelOptionChanges", () => {
  const descriptors = provider.models[0]!.capabilities?.optionDescriptors;

  it("labels changes from the model's descriptors and resolves omitted defaults", () => {
    const changes = modelOptionChanges(
      { instanceId: codex, model: "gpt-5.4" },
      {
        instanceId: codex,
        model: "gpt-5.4",
        options: [
          { id: "effort", value: "high" },
          { id: "fastMode", value: true },
          { id: "stale", value: "x" },
        ],
      },
      descriptors,
    );
    expect(formatModelOptionChanges(changes)).toBe(
      "Reasoning: Medium → High · Fast Mode: Off → On",
    );
  });

  it("compares raw values without descriptors and ignores model switches", () => {
    expect(
      modelOptionChanges(
        { instanceId: codex, model: "gpt-5.4" },
        { instanceId: codex, model: "gpt-5.4", options: [{ id: "effort", value: "high" }] },
      ),
    ).toEqual([{ id: "effort", label: "effort", from: "Default", to: "high" }]);
    expect(
      modelOptionChanges(
        { instanceId: codex, model: "gpt-5.4" },
        { instanceId: codex, model: "gpt-5.6", options: [{ id: "effort", value: "high" }] },
      ),
    ).toEqual([]);
  });
});
