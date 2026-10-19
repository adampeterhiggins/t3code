import {
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  describeModelChange,
  describeModelSelection,
  forkAccountChangeLabel,
  forkSourceInstanceId,
  formatModelSelectionTraits,
  handoffInstancesDiffer,
  modelChangeSourceSelection,
  modelChangeTurnItem,
  modelSelectionChanged,
  pendingModelChangeProjection,
  providerAccountLabel,
  selectionNeedsContextHandoff,
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

  it("labels a provider switch as the pending context handoff", () => {
    const pending = pendingModelChangeProjection({
      threadId,
      draft: { instanceId: claude, model: "claude-opus" },
      runs: [run(1, "gpt-5.4")],
      providers: [],
      now,
    });
    expect(pending?.item.type === "model_change" ? pending.item.title : null).toBe(
      "Context handoff pending",
    );
    expect(pending?.item.type === "model_change" ? pending.item.from.model : null).toBe("gpt-5.4");
    expect(pending?.item.type === "model_change" ? pending.item.to.model : null).toBe(
      "claude-opus",
    );
  });

  it("keeps an in-group account switch as a model change", () => {
    const personal = ProviderInstanceId.make("codex_personal");
    const shared = {
      driver: "codex",
      continuation: { groupKey: "shared" },
      models: [],
    } as unknown as ServerProvider;
    const from = { instanceId: codex, model: "gpt-5.4" };
    const to = { instanceId: personal, model: "gpt-5.4" };
    expect(
      selectionNeedsContextHandoff(from, to, [
        { ...shared, instanceId: codex },
        { ...shared, instanceId: personal },
      ]),
    ).toBe(false);
    expect(
      pendingModelChangeProjection({
        threadId,
        draft: to,
        runs: [run(1, "gpt-5.4")],
        providers: [
          { ...shared, instanceId: codex },
          { ...shared, instanceId: personal },
        ],
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

const cursor = ProviderDriverKind.make("cursor");
const work = ProviderInstanceId.make("cursor");
const personal = ProviderInstanceId.make("cursor_personal");

function cursorProvider(instanceId: ProviderInstanceId, displayName: string): ServerProvider {
  return {
    instanceId,
    driver: cursor,
    displayName,
    models: [{ slug: "grok-4.7", capabilities: { optionDescriptors: [] } }],
  } as unknown as ServerProvider;
}

describe("account change labels", () => {
  const from = { instanceId: work, model: "grok-4.7" };
  const to = { instanceId: personal, model: "grok-4.7" };
  const providers = [cursorProvider(work, "Work"), cursorProvider(personal, "Personal")];

  it("names an account switch inside the model change", () => {
    expect(describeModelChange(from, to, providers)).toBe(
      "Model changed from Work, grok-4.7 to Personal, grok-4.7.",
    );
    expect(describeModelChange(from, { ...to, model: "composer-2" }, providers)).toBe(
      "Model changed from Work, grok-4.7 to Personal, composer-2.",
    );
    expect(describeModelChange(from, { ...from, model: "composer-2" }, providers)).toBe(
      "Model changed from grok-4.7 to composer-2.",
    );
  });

  it("falls back to the instance id when the account is gone", () => {
    expect(providerAccountLabel([], personal)).toBe(personal);
    expect(describeModelChange(from, to)).toBe(
      `Model changed from ${work}, grok-4.7 to ${personal}, grok-4.7.`,
    );
  });

  it("humanizes a secondary account that still carries the brand name", () => {
    expect(
      providerAccountLabel(
        [{ instanceId: personal, driver: cursor, displayName: "Cursor" }],
        personal,
      ),
    ).toBe("Cursor Personal");
  });

  it("names a forked account switch from the fork transfer and skips a same-account fork", () => {
    const item = {
      threadId: ThreadId.make("thread:fork"),
      source: {
        type: "run" as const,
        threadId: ThreadId.make("thread:source"),
        runId: RunId.make("run:source"),
      },
    };
    const sourceInstanceId = forkSourceInstanceId(
      [
        {
          type: "fork",
          sourceThreadId: item.source.threadId,
          targetThreadId: item.threadId,
          sourcePoint: { threadId: item.source.threadId, runId: item.source.runId },
          sourceProviderInstanceId: work,
        },
      ],
      item,
    );
    expect(sourceInstanceId).toBe(work);
    expect(
      forkAccountChangeLabel({
        sourceInstanceId,
        targetInstanceId: personal,
        providers,
      }),
    ).toBe("Forked from Work to Personal");
    expect(
      forkAccountChangeLabel({
        sourceInstanceId: work,
        targetInstanceId: work,
        providers,
      }),
    ).toBeNull();
    expect(
      forkAccountChangeLabel({
        sourceInstanceId: null,
        targetInstanceId: personal,
        providers,
      }),
    ).toBeNull();
    expect(handoffInstancesDiffer([work], personal)).toBe(true);
    expect(handoffInstancesDiffer([work], work)).toBe(false);
  });

  it("records an in-place account switch as a model change item", () => {
    const changed = modelChangeTurnItem({
      id: TurnItemId.make("turn-item:account"),
      threadId,
      runId: RunId.make("run:account"),
      nodeId: null,
      providerThreadId: null,
      ordinal: 1,
      from,
      to,
      now,
    });
    expect(changed?.type).toBe("model_change");
    expect(changed?.from.instanceId).toBe(work);
    expect(changed?.to.instanceId).toBe(personal);
  });
});
