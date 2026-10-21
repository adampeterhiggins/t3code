import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const detached = vi.hoisted(() => ({ value: false }));

vi.mock("./quickMessageWindow", () => ({
  get isDetachedChatWindow() {
    return detached.value;
  },
}));

import { openDetachedComposerFileChooser } from "./detachedFileChooser";

function installWindow(bridge: unknown) {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("window", {
    desktopBridge: bridge,
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  });
  return {
    emit(type: string) {
      for (const listener of Array.from(listeners.get(type) ?? [])) listener();
    },
  };
}

function fileInput() {
  const listeners = new Map<string, Set<() => void>>();
  const input = {
    click: vi.fn(),
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of Array.from(listeners.get(type) ?? [])) listener();
    },
  };
  return input;
}

describe("openDetachedComposerFileChooser", () => {
  beforeEach(() => {
    detached.value = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicks the shared input when this is not the floating window", () => {
    detached.value = false;
    const begin = vi.fn(async () => undefined);
    installWindow({ nativeWindowInteraction: { begin, end: vi.fn() } });
    const input = fileInput();
    openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    expect(input.click).toHaveBeenCalledOnce();
    expect(begin).not.toHaveBeenCalled();
  });

  it("clicks the shared input when the shell has no interaction counter", () => {
    installWindow({});
    const input = fileInput();
    openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    expect(input.click).toHaveBeenCalledOnce();
    openDetachedComposerFileChooser(null);
  });

  it("holds the counter across change, cancel, and focus, including when the dialog returns first", async () => {
    let resolveBegin: (() => void) | undefined;
    const begin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveBegin = resolve;
        }),
    );
    const end = vi.fn(async () => undefined);
    const windowEvents = installWindow({ nativeWindowInteraction: { begin, end } });
    const input = fileInput();

    openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    expect(begin).toHaveBeenCalledOnce();
    expect(input.click).toHaveBeenCalledOnce();
    const beginOrder = begin.mock.invocationCallOrder[0];
    const clickOrder = input.click.mock.invocationCallOrder[0];
    if (beginOrder === undefined || clickOrder === undefined) {
      throw new Error("expected the chooser to begin and click");
    }
    expect(beginOrder).toBeLessThan(clickOrder);
    expect(end).not.toHaveBeenCalled();

    input.emit("change");
    expect(end).not.toHaveBeenCalled();
    resolveBegin?.();
    await Promise.resolve();
    expect(end).toHaveBeenCalledOnce();
    input.emit("change");
    windowEvents.emit("focus");
    expect(end).toHaveBeenCalledOnce();

    const cancelInput = fileInput();
    openDetachedComposerFileChooser(cancelInput as unknown as HTMLInputElement);
    resolveBegin?.();
    await Promise.resolve();
    cancelInput.emit("cancel");
    expect(end).toHaveBeenCalledTimes(2);
    windowEvents.emit("focus");
    expect(end).toHaveBeenCalledTimes(2);

    const focusInput = fileInput();
    openDetachedComposerFileChooser(focusInput as unknown as HTMLInputElement);
    resolveBegin?.();
    await Promise.resolve();
    windowEvents.emit("focus");
    expect(end).toHaveBeenCalledTimes(3);
    focusInput.emit("cancel");
    expect(end).toHaveBeenCalledTimes(3);
  });

  it("still opens the chooser when begin fails, and does not end a counter that never started", async () => {
    const begin = vi.fn(async () => Promise.reject(new Error("unavailable")));
    const end = vi.fn(async () => undefined);
    installWindow({ nativeWindowInteraction: { begin, end } });
    const input = fileInput();
    openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    await Promise.resolve();
    await Promise.resolve();
    expect(input.click).toHaveBeenCalledOnce();
    input.emit("change");
    input.emit("cancel");
    expect(end).not.toHaveBeenCalled();
  });
});
