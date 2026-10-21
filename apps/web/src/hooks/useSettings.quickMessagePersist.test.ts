import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/components/quickMessage/quickMessageWindow", () => ({
  isQuickMessageWindow: true,
}));

const persistenceMocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: persistenceMocks }),
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  adoptClientSettings,
  getClientSettings,
  persistClientSettingsPatch,
  persistClientSettingsUpdate,
} from "./useSettings";

beforeEach(() => {
  persistenceMocks.getClientSettings.mockReset().mockResolvedValue(null);
  persistenceMocks.setClientSettings.mockReset().mockResolvedValue(undefined);
  __resetClientSettingsPersistenceForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
});

describe("quick message client settings", () => {
  it("returns before a desktop write from a patch or update", async () => {
    await persistClientSettingsPatch({ wordWrap: false });
    await expect(
      persistClientSettingsUpdate((current) => ({ ...current, timestampFormat: "12-hour" })),
    ).resolves.toBe(DEFAULT_CLIENT_SETTINGS);

    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("adopts settings in memory without writing them back", () => {
    const adopted = {
      ...DEFAULT_CLIENT_SETTINGS,
      wordWrap: false,
      timestampFormat: "12-hour" as const,
    };
    adoptClientSettings(adopted);

    expect(getClientSettings()).toEqual(adopted);
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
    expect(persistenceMocks.getClientSettings).not.toHaveBeenCalled();
  });
});
