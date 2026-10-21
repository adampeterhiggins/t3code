import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme failure handling", () => {
  it("preserves exact storage causes and operation context", async () => {
    const readCause = new Error("storage read blocked");
    const writeCause = new Error("storage quota exceeded");
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw readCause;
        },
        setItem: () => {
          throw writeCause;
        },
      }),
    });

    const { readThemePreference, ThemeStorageError, writeThemePreference } =
      await import("./useTheme");

    try {
      readThemePreference();
      expect.unreachable("expected the theme read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "t3code:theme",
        cause: readCause,
      });
    }

    try {
      writeThemePreference("dark");
      expect.unreachable("expected the theme write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "t3code:theme",
        theme: "dark",
        cause: writeCause,
      });
    }
  });

  it("reads the persisted T3 Chat theme preference", async () => {
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => "t3-chat",
      }),
    });

    const { readThemePreference } = await import("./useTheme");

    expect(readThemePreference()).toBe("t3-chat");
  });

  it("falls back during initial theme application and logs only safe attributes", async () => {
    const cause = new Error("private browsing storage failure");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw cause;
        },
      }),
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
      },
    });

    await expect(import("./useTheme")).resolves.toBeDefined();

    expect(errorLog).toHaveBeenCalledWith(
      "Failed to read theme preference for t3code:theme.",
      expect.objectContaining({
        operation: "read",
        storageKey: "t3code:theme",
        errorTag: "ThemeStorageError",
      }),
    );
    const attributes = errorLog.mock.calls[0]?.[1];
    expect(attributes).not.toHaveProperty("cause");
    expect(JSON.stringify(attributes)).not.toContain(cause.message);
  });

  it("retries a failed storage read only after a relevant storage event", async () => {
    const cause = new Error("persistent storage failure");
    const themeGetItem = vi.fn((): string | null => {
      throw cause;
    });
    const getItem = vi.fn((key: string) => (key === "t3code:theme" ? themeGetItem() : null));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    let readSnapshot: (() => unknown) | undefined;
    let subscribeToTheme: ((listener: () => void) => () => void) | undefined;
    let storageHandler: ((event: StorageEvent) => void) | undefined;
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: (
        subscribe: (listener: () => void) => () => void,
        getSnapshot: () => unknown,
      ) => {
        subscribeToTheme = subscribe;
        readSnapshot = getSnapshot;
        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageHandler = listener;
      },
      localStorage: createStorage({ getItem }),
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      removeEventListener: () => undefined,
    });

    const { useTheme } = await import("./useTheme");
    useTheme();
    readSnapshot?.();
    readSnapshot?.();

    expect(themeGetItem).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);

    const unsubscribe = subscribeToTheme?.(() => undefined);
    storageHandler?.({ key: "t3code:theme" } as StorageEvent);
    readSnapshot?.();

    expect(themeGetItem).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(2);
    unsubscribe?.();
  });

  it("preserves desktop sync causes and retries after a failed cosmetic sync", async () => {
    const cause = new Error("desktop IPC unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const setTheme = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", {
      desktopBridge: { setTheme, getWindowRole: () => "main" },
      location: { hash: "" },
    });

    const { DesktopThemeSyncError, syncDesktopTheme, syncDesktopThemePreference } =
      await import("./useTheme");

    const error = await syncDesktopThemePreference({ setTheme }, "dark").then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(DesktopThemeSyncError);
    expect(error).toMatchObject({ theme: "dark", cause });

    setTheme.mockClear();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();

    expect(setTheme).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to sync the dark theme to the desktop shell.",
      expect.objectContaining({
        theme: "dark",
        errorTag: "DesktopThemeSyncError",
      }),
    );
    for (const [, attributes] of errorLog.mock.calls) {
      expect(attributes).not.toHaveProperty("cause");
      expect(JSON.stringify(attributes)).not.toContain(cause.message);
    }
  });
});

const THEME_STORAGE_KEY = "t3code:theme";
const THEME_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";
const THEME_HALVES_STORAGE_KEY = "t3code:theme-halves:v1";
const CUSTOM_THEMES_STORAGE_KEY = "t3code:themes:v1";

const harborTheme = {
  id: "harbor",
  label: "Harbor",
  appearance: "dark" as const,
  colors: { canvas: "#10243d" },
};

type ThemeSnapshotRead = {
  theme: string;
  resolvedTheme: "light" | "dark";
  systemDark: boolean;
  followSystem: boolean;
  appearanceMode: "light" | "dark" | "system";
  themeHalves: { light?: string; dark?: string } | null;
};

function mockThemeReact() {
  let readSnapshot: (() => ThemeSnapshotRead) | null = null;
  let runEffect: (() => void) | null = null;
  let notifications = 0;
  vi.doMock("react", () => ({
    useEffect: (effect: () => void) => {
      runEffect = effect;
    },
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => ThemeSnapshotRead,
    ) => {
      subscribe(() => {
        notifications += 1;
      });
      readSnapshot = getSnapshot;
      return getSnapshot();
    },
  }));
  return {
    read(): ThemeSnapshotRead {
      if (readSnapshot === null) throw new Error("theme snapshot was not read");
      return readSnapshot();
    },
    runEffect() {
      runEffect?.();
    },
    notifications() {
      return notifications;
    },
  };
}

function installThemeWindow(
  options: {
    role?: "main" | "quick-message";
    hash?: string;
    systemDark?: boolean;
    store?: Map<string, string>;
    themeReads?: { error: Error | null };
  } = {},
) {
  const store = options.store ?? new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => {
    store.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    store.delete(key);
  });
  let systemDark = options.systemDark ?? false;
  const mediaListeners = new Set<() => void>();
  const storageListeners = new Set<(event: StorageEvent) => void>();
  const setTheme = vi.fn().mockResolvedValue(undefined);
  const desktopBridge: {
    setTheme: typeof setTheme;
    getWindowRole?: () => "main" | "quick-message";
  } = { setTheme };
  if (options.role !== undefined) {
    const role = options.role;
    desktopBridge.getWindowRole = () => role;
  }
  const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
  const dataset: Record<string, string> = {};

  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        if (key === THEME_STORAGE_KEY && options.themeReads?.error) {
          throw options.themeReads.error;
        }
        return store.get(key) ?? null;
      },
      setItem,
      removeItem,
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
    desktopBridge,
    location: { hash: options.hash ?? "" },
    matchMedia: () => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        mediaListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        mediaListeners.delete(listener);
      },
    }),
    addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      if (type === "storage") storageListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      if (type === "storage") storageListeners.delete(listener);
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
      dataset,
      style,
      offsetHeight: 0,
    },
    querySelector: () => null,
    querySelectorAll: () => [] as Element[],
    head: { append: vi.fn() },
    body: {},
    createElement: () => ({ setAttribute: vi.fn(), name: "" }),
  });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: () => "",
    backgroundColor: "",
  }));

  return {
    store,
    setItem,
    removeItem,
    setTheme,
    dataset,
    style,
    setSystemDark(next: boolean) {
      systemDark = next;
      for (const listener of mediaListeners) listener();
    },
    emitStorage(key: string | null) {
      const event = { key } as StorageEvent;
      for (const listener of storageListeners) listener(event);
    },
  };
}

function styleWriteCount(style: {
  setProperty: ReturnType<typeof vi.fn>;
  removeProperty: ReturnType<typeof vi.fn>;
}) {
  return style.setProperty.mock.calls.length + style.removeProperty.mock.calls.length;
}

describe("presented appearance", () => {
  const presented = {
    theme: "t3-chat",
    appearanceMode: "dark" as const,
    halves: { dark: "harbor" },
    customThemes: [
      harborTheme,
      { id: "NOT VALID", label: "Nope", appearance: "dark", colors: { canvas: "#000000" } },
      { id: "dark", label: "Reserved", appearance: "dark", colors: { canvas: "#000000" } },
      null,
    ],
  };

  async function loadPresentedTheme(
    systemDark = false,
    extras?: {
      store?: Map<string, string>;
      themeReads?: { error: Error | null };
    },
  ) {
    const windowHarness = installThemeWindow({
      role: "main",
      systemDark,
      ...(extras?.store ? { store: extras.store } : {}),
      ...(extras?.themeReads ? { themeReads: extras.themeReads } : {}),
    });
    const react = mockThemeReact();
    const theme = await import("./useTheme");
    const palette = await import("../themePalette");
    const api = theme.useTheme();
    windowHarness.setItem.mockClear();
    windowHarness.removeItem.mockClear();
    windowHarness.setTheme.mockClear();
    return { windowHarness, react, theme, palette, api };
  }

  it("adopts custom themes in memory and does not write storage or the native theme", async () => {
    const { windowHarness, react, theme, palette } = await loadPresentedTheme();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);

    expect(() =>
      theme.adoptPresentedAppearance({ ...presented, appearanceMode: "auto" }),
    ).toThrow();
    expect(react.read().theme).toBe("system");
    expect(palette.getCustomThemes()).toEqual([]);

    theme.adoptPresentedAppearance(presented);
    const writesAfterAdopt = styleWriteCount(windowHarness.style);
    theme.adoptPresentedAppearance(presented);

    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
    expect(react.read()).toMatchObject({
      theme: "t3-chat",
      appearanceMode: "dark",
      resolvedTheme: "dark",
    });
    expect(react.read().themeHalves).toEqual({ dark: "harbor" });
    expect(
      palette.resolveThemeHalf("t3-chat", react.read().themeHalves, react.read().resolvedTheme),
    ).toBe("harbor");
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(styleWriteCount(windowHarness.style)).toBe(writesAfterAdopt);
    expect(theme.readCommittedAppearanceSnapshot()).toEqual({
      theme: "system",
      appearanceMode: "system",
      halves: null,
      customThemes: [],
    });
    expect(windowHarness.setItem).not.toHaveBeenCalled();
    expect(windowHarness.removeItem).not.toHaveBeenCalled();
    expect(windowHarness.setTheme).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    const api = theme.useTheme();
    expect(api.setTheme("grove")).toBe(false);
    expect(api.setAppearanceMode("light")).toBe(false);
    expect(api.setThemeHalf("light", "grove")).toBe(false);
    expect(api.clearThemeHalves()).toBe(false);
    expect(windowHarness.store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(windowHarness.store.has(CUSTOM_THEMES_STORAGE_KEY)).toBe(false);
    unsubscribe();
  });

  it("does not let a later theme effect or storage event replace the presented snapshot", async () => {
    const { windowHarness, react, theme } = await loadPresentedTheme();
    theme.adoptPresentedAppearance(presented);
    theme.useTheme();

    windowHarness.store.set(THEME_STORAGE_KEY, "grove");
    windowHarness.store.set(THEME_MODE_STORAGE_KEY, "light");
    windowHarness.store.set(
      THEME_HALVES_STORAGE_KEY,
      JSON.stringify({ light: "grove", dark: "grove" }),
    );
    react.runEffect();
    windowHarness.emitStorage(THEME_STORAGE_KEY);
    react.runEffect();

    expect(react.read()).toMatchObject({
      theme: "t3-chat",
      appearanceMode: "dark",
    });
    expect(react.read().themeHalves).toEqual({ dark: "harbor" });
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(windowHarness.setTheme).not.toHaveBeenCalled();
  });

  it("resolves system appearance and a later environment palette without adopting it", async () => {
    const { windowHarness, react, theme, palette, api } = await loadPresentedTheme(false);
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);
    const snapshot = {
      theme: "t3-chat",
      appearanceMode: "system" as const,
      halves: { light: "env-day", dark: "harbor" },
      customThemes: [harborTheme],
    };

    theme.adoptPresentedAppearance(snapshot);
    expect(react.read()).toMatchObject({
      theme: "t3-chat",
      appearanceMode: "system",
      followSystem: true,
      resolvedTheme: "light",
      systemDark: false,
    });
    expect(react.read().themeHalves).toEqual({ light: "env-day", dark: "harbor" });
    expect(react.read().resolvedTheme).toBe(
      palette.resolveThemeAppearance("t3-chat", false, true, "system", react.read().themeHalves),
    );
    expect(windowHarness.dataset.themeId).toBeUndefined();
    expect(palette.getEnvironmentThemes()).toEqual([]);

    const envDay = palette.parseThemeFile({
      version: palette.THEME_FILE_VERSION,
      id: "env-day",
      name: "Env Day",
      appearance: "light",
      colors: { canvas: "#f8fbff" },
    });
    expect(palette.setEnvironmentThemes([envDay])).toBe(true);
    api.refreshTheme();

    expect(listener).not.toHaveBeenCalled();
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
    expect(palette.getEnvironmentThemes().map((entry) => entry.id)).toEqual(["env-day"]);
    expect(react.read().theme).toBe("t3-chat");
    expect(windowHarness.dataset.themeId).toBe("env-day");
    expect(palette.resolveThemeHalf("t3-chat", react.read().themeHalves, "light")).toBe("env-day");

    windowHarness.setSystemDark(true);

    expect(react.read()).toMatchObject({
      appearanceMode: "system",
      followSystem: true,
      resolvedTheme: "dark",
      systemDark: true,
      theme: "t3-chat",
    });
    expect(palette.resolveThemeHalf("t3-chat", react.read().themeHalves, "dark")).toBe("harbor");
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(windowHarness.setTheme).not.toHaveBeenCalled();
    expect(windowHarness.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("returns the main window to its stored preference when the presented snapshot is released", async () => {
    const { windowHarness, react, theme, palette } = await loadPresentedTheme();
    theme.adoptPresentedAppearance(presented);
    windowHarness.store.set(THEME_STORAGE_KEY, "grove");

    theme.releasePresentedAppearance();

    expect(react.read().theme).toBe("grove");
    expect(palette.getCustomThemes()).toEqual([]);
    expect(windowHarness.dataset.themeId).toBe("grove");
    expect(windowHarness.setTheme).toHaveBeenCalledTimes(1);
    expect(windowHarness.setTheme).toHaveBeenCalledWith("light");
  });

  it("keeps the quick-message role from syncing or storing a theme", async () => {
    const windowHarness = installThemeWindow({ role: "quick-message" });
    mockThemeReact();
    const { syncDesktopTheme, syncDesktopThemePreference, useTheme } = await import("./useTheme");

    expect(windowHarness.setTheme).not.toHaveBeenCalled();
    syncDesktopTheme("dark");
    expect(windowHarness.setTheme).not.toHaveBeenCalled();

    await syncDesktopThemePreference({ setTheme: windowHarness.setTheme }, "dark");
    expect(windowHarness.setTheme).toHaveBeenCalledTimes(1);

    const api = useTheme();
    expect(api.setTheme("grove")).toBe(false);
    expect(api.setAppearanceMode("dark")).toBe(false);
    expect(api.setFollowSystem(false)).toBe(false);
    expect(windowHarness.store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(windowHarness.store.has(THEME_MODE_STORAGE_KEY)).toBe(false);
    expect(windowHarness.store.has(THEME_HALVES_STORAGE_KEY)).toBe(false);
  });

  it("keeps the legacy quick-message hash from syncing a native theme", async () => {
    const windowHarness = installThemeWindow({ hash: "#/quick-message" });
    const { syncDesktopTheme } = await import("./useTheme");

    expect(windowHarness.setTheme).not.toHaveBeenCalled();
    syncDesktopTheme("ocean");
    expect(windowHarness.setTheme).not.toHaveBeenCalled();
  });

  it("publishes committed custom themes, raw halves, and system resolution, not a preview", async () => {
    const store = new Map<string, string>([
      [THEME_STORAGE_KEY, "t3-chat"],
      [THEME_MODE_STORAGE_KEY, "system"],
      [THEME_HALVES_STORAGE_KEY, JSON.stringify({ light: "env-day", dark: harborTheme.id })],
      [
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify([harborTheme, { id: "NOT VALID", label: "Nope", appearance: "dark" }, null]),
      ],
    ]);
    const windowHarness = installThemeWindow({ role: "main", systemDark: true, store });
    const react = mockThemeReact();
    const theme = await import("./useTheme");
    const palette = await import("../themePalette");
    const api = theme.useTheme();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);

    const committed = theme.readCommittedAppearanceSnapshot();
    expect(committed).toMatchObject({
      theme: "t3-chat",
      appearanceMode: "system",
      halves: { light: "env-day", dark: "harbor" },
    });
    expect(committed.customThemes).toEqual([
      harborTheme,
      { id: "NOT VALID", label: "Nope", appearance: "dark" },
      null,
    ]);
    expect(react.read()).toMatchObject({
      theme: "t3-chat",
      appearanceMode: "system",
      followSystem: true,
      resolvedTheme: "dark",
    });
    expect(react.read().themeHalves).toEqual({ dark: "harbor" });
    expect(react.read().resolvedTheme).toBe(
      palette.resolveThemeAppearance(
        committed.theme,
        true,
        true,
        committed.appearanceMode,
        react.read().themeHalves,
      ),
    );
    expect(palette.resolveThemeHalf(committed.theme, react.read().themeHalves, "dark")).toBe(
      "harbor",
    );
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(listener).not.toHaveBeenCalled();

    const beforePreview = theme.readCommittedAppearanceSnapshot();
    palette.applyThemeColorPreview(palette.EMBER_THEME.colors, "dark");
    expect(listener).not.toHaveBeenCalled();
    expect(theme.readCommittedAppearanceSnapshot()).toEqual(beforePreview);

    palette.installCustomTheme(
      palette.parseThemeFile({
        version: palette.THEME_FILE_VERSION,
        id: "lagoon",
        name: "Lagoon",
        appearance: "light",
        colors: { canvas: "#f8fbff" },
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    const harbor = palette.getCustomThemes().find((entry) => entry.id === "harbor");
    if (!harbor) throw new Error("expected the stored harbor theme");
    palette.updateCustomTheme({ ...harbor, label: "Harbor Night" });
    expect(listener).toHaveBeenCalledTimes(2);

    expect(api.setAppearanceMode("dark")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(theme.readCommittedAppearanceSnapshot().appearanceMode).toBe("dark");
    unsubscribe();
  });

  it("publishes an unresolved base id and a stored custom the overlay does not carry", async () => {
    const inkTheme = {
      id: "ink",
      label: "Ink",
      appearance: "dark" as const,
      colors: { canvas: "#111111" },
    };
    const store = new Map<string, string>([
      [THEME_STORAGE_KEY, "env-night"],
      [CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([inkTheme])],
    ]);
    const { react, theme, palette } = await loadPresentedTheme(false, { store });

    expect(theme.readCommittedAppearanceSnapshot()).toEqual({
      theme: "env-night",
      appearanceMode: "light",
      halves: null,
      customThemes: [inkTheme],
    });
    expect(react.read()).toMatchObject({ theme: "system", appearanceMode: "system" });
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["ink"]);
    expect(palette.getEnvironmentThemes()).toEqual([]);

    theme.adoptPresentedAppearance(presented);

    expect(theme.readCommittedAppearanceSnapshot()).toEqual({
      theme: "env-night",
      appearanceMode: "light",
      halves: null,
      customThemes: [inkTheme],
    });
    expect(react.read()).toMatchObject({ theme: "t3-chat", appearanceMode: "dark" });
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
    expect(react.read().themeHalves).toEqual({ dark: "harbor" });

    store.set(THEME_MODE_STORAGE_KEY, "dark");
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "env-night",
      appearanceMode: "dark",
    });
    store.delete(THEME_MODE_STORAGE_KEY);
    expect(theme.readCommittedAppearanceSnapshot().appearanceMode).toBe("light");

    store.set(THEME_STORAGE_KEY, "ink");
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "ink",
      appearanceMode: "dark",
      customThemes: [inkTheme],
    });
    expect(react.read()).toMatchObject({ theme: "t3-chat", appearanceMode: "dark" });
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);

    store.set(THEME_STORAGE_KEY, "t3-grove");
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "grove",
      appearanceMode: "light",
    });

    store.set(THEME_STORAGE_KEY, "t3-chat-dark");
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "t3-chat-dark",
      appearanceMode: "dark",
    });

    store.delete(THEME_STORAGE_KEY);
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "system",
      appearanceMode: "system",
    });
    expect(react.read()).toMatchObject({ theme: "t3-chat", appearanceMode: "dark" });
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
  });

  it("refreshes the stored library on release after external writes while presented", async () => {
    const inkTheme = {
      id: "ink",
      label: "Ink",
      appearance: "dark" as const,
      colors: { canvas: "#111111" },
    };
    const lagoonTheme = {
      id: "lagoon",
      label: "Lagoon",
      appearance: "light" as const,
      colors: { canvas: "#f8fbff" },
    };
    const cedarTheme = {
      id: "cedar",
      label: "Cedar",
      appearance: "dark" as const,
      colors: { canvas: "#10243d" },
    };
    const duneTheme = {
      id: "dune",
      label: "Dune",
      appearance: "light" as const,
      colors: { canvas: "#f4efe6" },
    };
    const store = new Map<string, string>([
      [THEME_STORAGE_KEY, "ink"],
      [CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([inkTheme])],
    ]);
    const { windowHarness, react, theme, palette } = await loadPresentedTheme(false, { store });
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["ink"]);
    theme.adoptPresentedAppearance(presented);
    const painted = react.notifications();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);
    windowHarness.setTheme.mockClear();

    store.set(THEME_STORAGE_KEY, "lagoon");
    store.set(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([lagoonTheme]));
    windowHarness.emitStorage(CUSTOM_THEMES_STORAGE_KEY);
    windowHarness.emitStorage(THEME_STORAGE_KEY);

    expect(react.notifications()).toBe(painted);
    expect(listener).not.toHaveBeenCalled();
    expect(windowHarness.setTheme).not.toHaveBeenCalled();
    expect(react.read()).toMatchObject({ theme: "t3-chat", appearanceMode: "dark" });
    expect(react.read().themeHalves).toEqual({ dark: "harbor" });
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "lagoon",
      appearanceMode: "light",
      customThemes: [lagoonTheme],
    });

    store.set(THEME_STORAGE_KEY, "cedar");
    store.set(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([cedarTheme]));
    windowHarness.emitStorage(null);

    expect(react.notifications()).toBe(painted);
    expect(listener).not.toHaveBeenCalled();
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
    expect(theme.readCommittedAppearanceSnapshot()).toMatchObject({
      theme: "cedar",
      appearanceMode: "dark",
      customThemes: [cedarTheme],
    });

    store.set(THEME_STORAGE_KEY, "dune");
    store.set(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([duneTheme]));
    expect(theme.readCommittedAppearanceSnapshot().customThemes).toEqual([cedarTheme]);

    theme.releasePresentedAppearance();

    expect(react.read()).toMatchObject({ theme: "dune", appearanceMode: "light" });
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["dune"]);
    expect(windowHarness.dataset.themeId).toBe("dune");
    expect(windowHarness.setTheme).toHaveBeenCalledTimes(1);
    expect(windowHarness.setTheme).toHaveBeenCalledWith("light");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("retries a recovered theme read on release without painting it while presented", async () => {
    const cause = new Error("theme read blocked");
    const themeReads = { error: cause as Error | null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new Map<string, string>();
    const { windowHarness, react, theme } = await loadPresentedTheme(false, { store, themeReads });
    theme.adoptPresentedAppearance(presented);
    const painted = react.notifications();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);
    windowHarness.setTheme.mockClear();

    themeReads.error = null;
    store.set(THEME_STORAGE_KEY, "grove");
    windowHarness.emitStorage(THEME_STORAGE_KEY);

    expect(react.notifications()).toBe(painted);
    expect(listener).not.toHaveBeenCalled();
    expect(react.read()).toMatchObject({ theme: "t3-chat", appearanceMode: "dark" });
    expect(windowHarness.dataset.themeId).toBe("harbor");
    expect(windowHarness.setTheme).not.toHaveBeenCalled();

    theme.releasePresentedAppearance();

    expect(react.read().theme).toBe("grove");
    expect(windowHarness.dataset.themeId).toBe("grove");
    expect(windowHarness.setTheme).toHaveBeenCalledTimes(1);
    expect(windowHarness.setTheme).toHaveBeenCalledWith("light");
    unsubscribe();
  });

  it("rejects custom theme library writes while a snapshot is presented", async () => {
    const inkTheme = {
      id: "ink",
      label: "Ink",
      appearance: "dark" as const,
      colors: { canvas: "#111111" },
    };
    const store = new Map<string, string>([
      [CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([inkTheme])],
    ]);
    const { windowHarness, theme, palette } = await loadPresentedTheme(false, { store });
    theme.adoptPresentedAppearance(presented);
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);
    windowHarness.setItem.mockClear();

    expectInstalledThemesReadOnly(palette, store, windowHarness.setItem, listener);
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["harbor"]);
    unsubscribe();
  });

  it("rejects custom theme library writes from the quick-message window", async () => {
    const inkTheme = {
      id: "ink",
      label: "Ink",
      appearance: "dark" as const,
      colors: { canvas: "#111111" },
    };
    const store = new Map<string, string>([
      [CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([inkTheme])],
    ]);
    const windowHarness = installThemeWindow({ role: "quick-message", store });
    mockThemeReact();
    const theme = await import("./useTheme");
    const palette = await import("../themePalette");
    const listener = vi.fn();
    const unsubscribe = theme.subscribeCommittedAppearanceChanges(listener);
    windowHarness.setItem.mockClear();

    expectInstalledThemesReadOnly(palette, store, windowHarness.setItem, listener);
    expect(palette.getCustomThemes().map((entry) => entry.id)).toEqual(["ink"]);
    unsubscribe();
  });
});

function expectInstalledThemesReadOnly(
  palette: typeof import("../themePalette"),
  store: Map<string, string>,
  setItem: { mock: { calls: unknown[] } },
  listener: { mock: { calls: unknown[] } },
) {
  const stored = store.get(CUSTOM_THEMES_STORAGE_KEY);
  const lagoon = palette.parseThemeFile({
    version: palette.THEME_FILE_VERSION,
    id: "lagoon",
    name: "Lagoon",
    appearance: "light",
    colors: { canvas: "#f8fbff" },
  });
  const ink = palette.parseThemeFile({
    version: palette.THEME_FILE_VERSION,
    id: "ink",
    name: "Ink",
    appearance: "dark",
    colors: { canvas: "#111111" },
  });
  const packed = { ...lagoon, collection: { id: "pack", label: "Pack" } };

  expect(() => palette.installCustomTheme(lagoon)).toThrow(/read-only/);
  expect(() => palette.updateCustomTheme(ink)).toThrow(/read-only/);
  expect(() => palette.removeCustomTheme("ink")).toThrow(/read-only/);
  expect(() => palette.removeCustomThemes(["ink"])).toThrow(/read-only/);
  expect(() => palette.replaceCustomThemeCollection("pack", [packed])).toThrow(/read-only/);
  expect(store.get(CUSTOM_THEMES_STORAGE_KEY)).toBe(stored);
  expect(setItem.mock.calls).toHaveLength(0);
  expect(listener.mock.calls).toHaveLength(0);
}
