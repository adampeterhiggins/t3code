import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, render } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () =>
    ({
      theme: "system",
      followSystem: true,
      themeHalves: null,
      setTheme: vi.fn(),
      setFollowSystem: vi.fn(),
      setThemeHalf: vi.fn(),
      clearThemeHalves: vi.fn(),
    }) as never,
  readThemePreference: () => "system",
  readThemeHalves: () => null,
  readAppearanceModePreference: () => "system",
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings!) as never,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => ({ dialogs: { confirm: state.confirm } }) as never,
}));

import { useSettingsRestore } from "./SettingsPanels";

function Probe({ ready }: { ready: (restore: ReturnType<typeof useSettingsRestore>) => void }) {
  const result = useSettingsRestore();
  useEffect(() => ready(result), [ready, result]);
  return null;
}

function setup() {
  vi.clearAllMocks();
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.confirm.mockResolvedValue(true);
}

describe("restoring V2 settings", () => {
  it.each([
    ["persistComposerContextStrip", "Composer context"],
    ["stopAtSubscriptionLimit", "Stop at subscription limit"],
    ["autoResumeLimitedThreads", "Resume after usage limits"],
    ["snoozeLimitedThreads", "Snooze until limits reset"],
  ] as const)("restores %s when it is the only changed setting", async (key, label) => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, [key]: true };
    let restore!: ReturnType<typeof useSettingsRestore>;
    await using _screen = await render(
      <Probe
        ready={(result) => {
          restore = result;
        }}
      />,
    );

    expect(restore.changedSettingLabels).toEqual([label]);
    await act(() => restore.restoreDefaults());

    expect(state.confirm.mock.calls[0]?.[0]).toContain(label);
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.update.mock.calls[0]?.[0][key]).toBe(DEFAULT_UNIFIED_SETTINGS[key]);
  });

  it("does not reset settings after cancellation", async () => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, autoResumeLimitedThreads: true };
    state.confirm.mockResolvedValue(false);
    let restore!: ReturnType<typeof useSettingsRestore>;
    await using _screen = await render(
      <Probe
        ready={(result) => {
          restore = result;
        }}
      />,
    );

    await act(() => restore.restoreDefaults());

    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.update).not.toHaveBeenCalled();
  });
});
