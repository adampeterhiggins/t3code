import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { AppModelOption } from "~/modelSelection";
import { providerModelKey } from "~/modelOrdering";
import type { ProviderInstanceEntry } from "~/providerInstances";

import { deriveComposerModelItems } from "./composerModelItems";
import { modelContextOptions } from "./modelReferences";

const symphony = ProviderInstanceId.make("cursor_symphony");
const claude = ProviderInstanceId.make("claudeAgent");

function entry(
  instanceId: ProviderInstanceId,
  driver: string,
  displayName: string,
  enabled = true,
): ProviderInstanceEntry {
  return {
    instanceId,
    driverKind: ProviderDriverKind.make(driver),
    displayName,
    enabled,
    installed: true,
    status: "ready",
    isDefault: false,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [],
  };
}

function options(...names: string[]): AppModelOption[] {
  return names.map((name) => ({
    slug: name.toLowerCase().replaceAll(" ", "-"),
    name,
    isCustom: false,
  }));
}

const entries = [
  entry(symphony, "cursor", "symphony"),
  entry(claude, "claudeAgent", "Claude"),
  entry(ProviderInstanceId.make("codex"), "codex", "Codex", false),
];
const modelOptionsByInstance = new Map([
  [symphony, options("Grok 4.7", "Composer 2")],
  [claude, options("Claude Opus 5.5", "Claude Sonnet 5.5")],
  [ProviderInstanceId.make("codex"), options("GPT-6 Codex")],
]);

function derive(input: { query?: string; instanceFilter?: ProviderInstanceId | null }) {
  return deriveComposerModelItems({
    enabled: true,
    query: input.query ?? "",
    entries,
    modelOptionsByInstance,
    favoriteKeys: new Set([providerModelKey(claude, "claude-sonnet-5.5")]),
    instanceFilter: input.instanceFilter ?? null,
  });
}

describe("deriveComposerModelItems", () => {
  it("lists enabled instances' models with favourites first", () => {
    const result = derive({});
    expect(result.items.map((item) => item.label)).toEqual([
      "Claude Sonnet 5.5",
      "Grok 4.7",
      "Composer 2",
      "Claude Opus 5.5",
    ]);
    expect(result.instances.map((instance) => instance.instanceId)).toEqual([symphony, claude]);
    expect(result.prefersModels).toBe(false);
  });

  it("opens on the Models tab when the query starts a word of a model's name", () => {
    const result = derive({ query: "grok" });
    expect(result.prefersModels).toBe(true);
    expect(result.items[0]?.label).toBe("Grok 4.7");
    expect(derive({ query: "opus" }).prefersModels).toBe(true);
    expect(derive({ query: "pus" }).prefersModels).toBe(false);
  });

  it("narrows to one provider instance but keeps every instance as a filter", () => {
    const result = derive({ instanceFilter: claude });
    expect(result.items.every((item) => item.entry.instanceId === claude)).toBe(true);
    expect(result.instances).toHaveLength(2);
  });

  it("lists nothing while the @ menu is closed", () => {
    expect(
      deriveComposerModelItems({
        enabled: false,
        query: "grok",
        entries,
        modelOptionsByInstance,
        favoriteKeys: new Set(),
        instanceFilter: null,
      }).items,
    ).toEqual([]);
  });
});

describe("modelContextOptions", () => {
  const model: ServerProviderModel = {
    slug: "grok-4.7",
    name: "Grok 4.7",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
          ],
        },
        { id: "fastMode", label: "Fast Mode", type: "boolean" },
      ],
    },
  };

  it("labels each selection as the model described it", () => {
    expect(
      modelContextOptions(model, [
        { id: "effort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([
      { id: "effort", value: "high", label: "Reasoning", valueLabel: "High" },
      { id: "fastMode", value: true, label: "Fast Mode", valueLabel: "On" },
    ]);
  });

  it("drops selections the model no longer offers", () => {
    expect(
      modelContextOptions(model, [
        { id: "effort", value: "ultra" },
        { id: "contextWindow", value: "1m" },
        { id: "fastMode", value: "yes" },
      ]),
    ).toEqual([]);
  });
});
