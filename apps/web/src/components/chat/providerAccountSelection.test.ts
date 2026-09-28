import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  accountsForProvider,
  dedupeModelPickerItemsByDriverSlug,
  isDriverModelFavorite,
  providerBrandLabel,
  resolveInstanceForModelSelection,
  resolveModelForAccountSwitch,
  shouldShowProviderAccountPicker,
  uniqueProviderRailEntries,
} from "./providerAccountSelection";
import { providerModelKey } from "../../modelOrdering";

function entry(
  instanceId: string,
  driver: string,
  options?: { enabled?: boolean; continuationGroupKey?: string },
) {
  return deriveProviderInstanceEntries([
    {
      instanceId: ProviderInstanceId.make(instanceId),
      driver: ProviderDriverKind.make(driver),
      enabled: options?.enabled ?? true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-08-28T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
      ...(options?.continuationGroupKey
        ? { continuation: { groupKey: options.continuationGroupKey } }
        : {}),
    } satisfies ServerProvider,
  ])[0]!;
}

describe("providerBrandLabel", () => {
  it("uses the brand name for known drivers", () => {
    expect(providerBrandLabel(ProviderDriverKind.make("cursor"))).toBe("Cursor");
  });
});

describe("accountsForProvider / shouldShowProviderAccountPicker", () => {
  const adam = entry("cursor_adam", "cursor");
  const symphony = entry("cursor_symphony", "cursor");
  const codex = entry("codex", "codex");
  const disabled = entry("cursor_disabled", "cursor", { enabled: false });

  it("lists enabled accounts for one driver", () => {
    expect(
      accountsForProvider({
        entries: [adam, symphony, codex, disabled],
        driverKind: ProviderDriverKind.make("cursor"),
      }).map((candidate) => candidate.instanceId),
    ).toEqual(["cursor_adam", "cursor_symphony"]);
  });

  it("shows the picker only when more than one account is enabled", () => {
    expect(shouldShowProviderAccountPicker([adam])).toBe(false);
    expect(shouldShowProviderAccountPicker([adam, symphony])).toBe(true);
  });

  it("respects continuation group locks", () => {
    const homeA = entry("codex_a", "codex", { continuationGroupKey: "home-a" });
    const homeB = entry("codex_b", "codex", { continuationGroupKey: "home-b" });
    expect(
      accountsForProvider({
        entries: [homeA, homeB],
        driverKind: ProviderDriverKind.make("codex"),
        lockedContinuationGroupKey: "home-a",
      }).map((candidate) => candidate.instanceId),
    ).toEqual(["codex_a"]);
  });
});

describe("uniqueProviderRailEntries", () => {
  it("keeps the first instance of each driver", () => {
    const adam = entry("cursor_adam", "cursor");
    const symphony = entry("cursor_symphony", "cursor");
    const codex = entry("codex", "codex");
    expect(
      uniqueProviderRailEntries([adam, symphony, codex]).map((candidate) => candidate.instanceId),
    ).toEqual(["cursor_adam", "codex"]);
  });
});

describe("resolveInstanceForModelSelection", () => {
  const adam = entry("cursor_adam", "cursor");
  const symphony = entry("cursor_symphony", "cursor");
  const defaultCursor = entry("cursor", "cursor");
  const entries = [adam, symphony, defaultCursor];
  const modelOptionsByInstance = new Map([
    [adam.instanceId, [{ slug: "grok-4.5" }, { slug: "grok-4.6" }]],
    [symphony.instanceId, [{ slug: "grok-4.5" }]],
    [defaultCursor.instanceId, [{ slug: "grok-4.6" }]],
  ]);

  it("prefers the active account when it offers the model", () => {
    expect(
      resolveInstanceForModelSelection({
        entries,
        modelOptionsByInstance,
        driverKind: ProviderDriverKind.make("cursor"),
        slug: "grok-4.5",
        preferredInstanceId: symphony.instanceId,
      }),
    ).toBe(symphony.instanceId);
  });

  it("falls back to the default driver instance, then any ready account", () => {
    expect(
      resolveInstanceForModelSelection({
        entries,
        modelOptionsByInstance,
        driverKind: ProviderDriverKind.make("cursor"),
        slug: "grok-4.6",
      }),
    ).toBe(defaultCursor.instanceId);
    expect(
      resolveInstanceForModelSelection({
        entries: [adam, symphony],
        modelOptionsByInstance,
        driverKind: ProviderDriverKind.make("cursor"),
        slug: "grok-4.5",
      }),
    ).toBe(adam.instanceId);
  });
});

describe("dedupeModelPickerItemsByDriverSlug", () => {
  it("collapses the same model across accounts of one driver", () => {
    const adam = entry("cursor_adam", "cursor");
    const symphony = entry("cursor_symphony", "cursor");
    const grok = entry("grok", "grok");
    const items = [
      {
        instanceId: adam.instanceId,
        driverKind: adam.driverKind,
        slug: "grok-4.5",
        name: "Grok 4.5",
      },
      {
        instanceId: symphony.instanceId,
        driverKind: symphony.driverKind,
        slug: "grok-4.5",
        name: "Grok 4.5",
      },
      {
        instanceId: grok.instanceId,
        driverKind: grok.driverKind,
        slug: "grok-4.5",
        name: "Grok 4.5",
      },
    ];
    const modelOptionsByInstance = new Map([
      [adam.instanceId, [{ slug: "grok-4.5" }]],
      [symphony.instanceId, [{ slug: "grok-4.5" }]],
      [grok.instanceId, [{ slug: "grok-4.5" }]],
    ]);

    expect(
      dedupeModelPickerItemsByDriverSlug(items, {
        entries: [adam, symphony, grok],
        modelOptionsByInstance,
        preferredInstanceId: symphony.instanceId,
      }).map((item) => `${item.driverKind}:${item.instanceId}`),
    ).toEqual(["cursor:cursor_symphony", "grok:grok"]);
  });
});

describe("isDriverModelFavorite", () => {
  it("treats a favorite on any account of the driver as favorited", () => {
    const adam = entry("cursor_adam", "cursor");
    const symphony = entry("cursor_symphony", "cursor");
    const favoritesSet = new Set([providerModelKey(symphony.instanceId, "grok-4.5")]);
    expect(
      isDriverModelFavorite({
        favoritesSet,
        driverKind: ProviderDriverKind.make("cursor"),
        slug: "grok-4.5",
        entries: [adam, symphony],
      }),
    ).toBe(true);
    expect(
      isDriverModelFavorite({
        favoritesSet,
        driverKind: ProviderDriverKind.make("cursor"),
        slug: "other",
        entries: [adam, symphony],
      }),
    ).toBe(false);
  });
});

describe("resolveModelForAccountSwitch", () => {
  it("keeps the current model when the destination offers it", () => {
    expect(
      resolveModelForAccountSwitch({
        currentModel: "grok-4.5",
        destinationModels: [{ slug: "grok-4.5" }, { slug: "grok-4.6" }],
      }),
    ).toBe("grok-4.5");
  });

  it("falls back to the destination default when the current model is missing", () => {
    expect(
      resolveModelForAccountSwitch({
        currentModel: "missing",
        destinationModels: [
          { slug: "other", isDefault: false },
          { slug: "default-model", isDefault: true },
        ],
      }),
    ).toBe("default-model");
  });
});
