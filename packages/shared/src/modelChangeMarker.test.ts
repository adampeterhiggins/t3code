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
  describeModelSelection,
  formatModelSelectionTraits,
  modelChangeSourceSelection,
  modelChangeTurnItem,
  modelSelectionChanged,
  pendingModelChangeProjection,
} from "./modelChangeMarker.ts";

const threadId = ThreadId.make("thread:model-change");
const now = DateTime.makeUnsafe("2026-10-07T00:00:00.000Z");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

const provider = {
  instanceId: codex,
  driver: "codex",
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
    expect(changed?.title).toBe("Model changed");
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
    ).toBe("Model changed");
  });
});

describe("modelSelectionChanged", () => {
  const descriptors = provider.models[0]!.capabilities?.optionDescriptors;

  it("resolves omitted options to defaults and ignores options the model lacks", () => {
    const base = { instanceId: codex, model: "gpt-5.4" };
    expect(
      modelSelectionChanged(
        base,
        {
          ...base,
          options: [
            { id: "effort", value: "medium" },
            { id: "stale", value: "x" },
          ],
        },
        descriptors,
      ),
    ).toBe(false);
    expect(
      modelSelectionChanged(
        base,
        { ...base, options: [{ id: "fastMode", value: true }] },
        descriptors,
      ),
    ).toBe(true);
  });

  it("compares raw values without descriptors", () => {
    const base = { instanceId: codex, model: "gpt-5.4" };
    expect(
      modelSelectionChanged(base, { ...base, options: [{ id: "effort", value: "medium" }] }),
    ).toBe(true);
    expect(modelSelectionChanged(base, { ...base, model: "gpt-5.6" })).toBe(true);
  });
});

describe("model selection labels", () => {
  const selection = {
    instanceId: codex,
    model: "gpt-5.4",
    options: [
      { id: "effort", value: "high" },
      { id: "fastMode", value: true },
    ],
  };

  it("labels parameters the way the composer does", () => {
    expect(formatModelSelectionTraits([provider], selection)).toBe("High Fast");
    expect(formatModelSelectionTraits([provider], { instanceId: codex, model: "gpt-5.4" })).toBe(
      "Medium",
    );
    expect(formatModelSelectionTraits([], selection)).toBeNull();
  });

  it("describes a selection without a provider catalog", () => {
    expect(describeModelSelection(selection)).toBe("gpt-5.4 (effort: high, fastMode: true)");
    expect(describeModelSelection({ instanceId: codex, model: "gpt-5.4" })).toBe("gpt-5.4");
  });
});
