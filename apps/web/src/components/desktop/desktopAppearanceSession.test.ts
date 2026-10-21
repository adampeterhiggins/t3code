import type { ClientSettings, DesktopAppearanceSnapshot } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  startDesktopAppearanceSession,
  type DesktopAppearanceTransport,
} from "./desktopAppearanceSession";

const committed: DesktopAppearanceSnapshot = {
  theme: "harbor",
  appearanceMode: "dark",
  halves: null,
  customThemes: [],
};

const newer: DesktopAppearanceSnapshot = {
  theme: "environment-palette-pending",
  appearanceMode: "system",
  halves: { dark: "custom-not-yet-loaded" },
  customThemes: [{ id: "cedar" }],
};

const settings: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, wordWrap: false };

/**
 * A `let` assigned only inside a callback is narrowed to its initial `null`
 * by the time the test calls it. A property stays the declared function type.
 */
function hold<A>(): { current: A | null } {
  return { current: null };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("startDesktopAppearanceSession", () => {
  it("publishes committed snapshots in order and does not adopt them", async () => {
    let current = committed;
    const listener = hold<() => void>();
    const releaseFirst = hold<() => void>();
    const adopted: Array<unknown> = [];
    const published: Array<DesktopAppearanceSnapshot> = [];
    const publishAppearanceSnapshot = vi.fn((snapshot: DesktopAppearanceSnapshot) => {
      published.push(snapshot);
      if (published.length === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst.current = resolve;
        });
      }
      return Promise.resolve();
    });

    const stop = startDesktopAppearanceSession({
      role: "main",
      bridge: { publishAppearanceSnapshot },
      readCommitted: () => current,
      subscribeCommitted: (next) => {
        listener.current = next;
        return () => {
          listener.current = null;
        };
      },
      adoptAppearance: (snapshot) => {
        adopted.push(snapshot);
      },
      adoptSettings: () => {
        throw new Error("main does not adopt settings");
      },
    });

    await flush();
    expect(published).toEqual([committed]);
    expect(adopted).toEqual([]);

    current = newer;
    listener.current?.();
    await flush();
    expect(published).toEqual([committed]);

    releaseFirst.current?.();
    await flush();
    expect(published.map((snapshot) => snapshot.theme)).toEqual([
      "harbor",
      "environment-palette-pending",
    ]);
    expect(adopted).toEqual([]);

    stop();
    current = committed;
    listener.current?.();
    await flush();
    expect(published).toHaveLength(2);
  });

  it("continues the publish queue after a failed write", async () => {
    let current = committed;
    const listener = hold<() => void>();
    const publishAppearanceSnapshot = vi
      .fn<(snapshot: DesktopAppearanceSnapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error("ipc closed"))
      .mockResolvedValue(undefined);

    startDesktopAppearanceSession({
      role: "main",
      bridge: { publishAppearanceSnapshot },
      readCommitted: () => current,
      subscribeCommitted: (next) => {
        listener.current = next;
        return () => undefined;
      },
      adoptAppearance: () => undefined,
      adoptSettings: () => undefined,
    });
    await flush();
    current = newer;
    listener.current?.();
    await flush();

    expect(publishAppearanceSnapshot.mock.calls.map((call) => call[0])).toEqual([committed, newer]);
  });

  it("leaves the local theme engine in place when the bridge cannot publish", () => {
    let subscribed = false;
    startDesktopAppearanceSession({
      role: "main",
      bridge: {},
      readCommitted: () => committed,
      subscribeCommitted: () => {
        subscribed = true;
        return () => undefined;
      },
      adoptAppearance: () => {
        throw new Error("missing bridge must not adopt");
      },
      adoptSettings: () => undefined,
    });
    expect(subscribed).toBe(false);
  });

  it("does not let a stale snapshot read replace a newer event", async () => {
    const listener = hold<(snapshot: DesktopAppearanceSnapshot) => void>();
    const resolveGet = hold<(snapshot: DesktopAppearanceSnapshot | null) => void>();
    const adopted: Array<unknown> = [];
    const publishAppearanceSnapshot = vi.fn();
    const bridge: DesktopAppearanceTransport = {
      publishAppearanceSnapshot,
      onAppearanceSnapshot: (next) => {
        listener.current = next;
        return () => {
          listener.current = null;
        };
      },
      getAppearanceSnapshot: () =>
        new Promise((resolve) => {
          resolveGet.current = resolve;
        }),
    };

    const stop = startDesktopAppearanceSession({
      role: "floating",
      bridge,
      readCommitted: () => {
        throw new Error("floating does not publish local preferences");
      },
      subscribeCommitted: () => {
        throw new Error("floating does not subscribe to its own commits");
      },
      adoptAppearance: (snapshot) => {
        adopted.push(snapshot);
      },
      adoptSettings: () => undefined,
    });

    expect(listener.current).not.toBeNull();
    expect(resolveGet.current).not.toBeNull();
    listener.current?.(newer);
    resolveGet.current?.(committed);
    await flush();

    expect(adopted).toEqual([newer]);
    expect(publishAppearanceSnapshot).not.toHaveBeenCalled();

    stop();
    listener.current?.(committed);
    await flush();
    expect(adopted).toEqual([newer]);
  });

  it("does not adopt when the stored snapshot is missing", async () => {
    const adopted: Array<unknown> = [];
    const resolveGet = hold<(snapshot: DesktopAppearanceSnapshot | null) => void>();
    startDesktopAppearanceSession({
      role: "floating",
      bridge: {
        onAppearanceSnapshot: () => () => undefined,
        getAppearanceSnapshot: () =>
          new Promise((resolve) => {
            resolveGet.current = resolve;
          }),
      },
      readCommitted: () => committed,
      subscribeCommitted: () => () => undefined,
      adoptAppearance: (snapshot) => {
        adopted.push(snapshot);
      },
      adoptSettings: () => undefined,
    });

    resolveGet.current?.(null);
    await flush();
    expect(adopted).toEqual([]);
  });

  it("adopts a settled initial snapshot and an exact settings event without publishing", async () => {
    const adoptedAppearance: Array<unknown> = [];
    const adoptedSettings: Array<ClientSettings> = [];
    const settingsListener = hold<(settings: ClientSettings) => void>();
    const resolveSettings = hold<(settings: ClientSettings | null) => void>();
    const publishAppearanceSnapshot = vi.fn();

    startDesktopAppearanceSession({
      role: "floating",
      bridge: {
        publishAppearanceSnapshot,
        onAppearanceSnapshot: () => () => undefined,
        getAppearanceSnapshot: () => Promise.resolve(committed),
        onClientSettings: (next) => {
          settingsListener.current = next;
          return () => {
            settingsListener.current = null;
          };
        },
        getClientSettings: () =>
          new Promise((resolve) => {
            resolveSettings.current = resolve;
          }),
      },
      readCommitted: () => committed,
      subscribeCommitted: () => () => undefined,
      adoptAppearance: (snapshot) => {
        adoptedAppearance.push(snapshot);
      },
      adoptSettings: (next) => {
        adoptedSettings.push(next);
      },
    });

    await flush();
    expect(adoptedAppearance).toEqual([committed]);
    expect(resolveSettings.current).not.toBeNull();
    settingsListener.current?.(settings);
    resolveSettings.current?.(DEFAULT_CLIENT_SETTINGS);
    await flush();

    expect(adoptedSettings).toEqual([settings]);
    expect(publishAppearanceSnapshot).not.toHaveBeenCalled();
  });

  it("does not adopt when the appearance bridge is incomplete", () => {
    const getAppearanceSnapshot = vi.fn(() => Promise.resolve(committed));
    startDesktopAppearanceSession({
      role: "floating",
      bridge: { getAppearanceSnapshot },
      readCommitted: () => committed,
      subscribeCommitted: () => () => undefined,
      adoptAppearance: () => {
        throw new Error("incomplete bridge must not adopt");
      },
      adoptSettings: () => undefined,
    });
    expect(getAppearanceSnapshot).not.toHaveBeenCalled();
  });
});
