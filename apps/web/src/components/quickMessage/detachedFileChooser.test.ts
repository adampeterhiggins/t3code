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
    const begin = vi.fn(() => true);
    installWindow({ nativeWindowInteraction: { begin, end: vi.fn() } });
    const input = fileInput();
    openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    expect(input.click).toHaveBeenCalledOnce();
    expect(begin).not.toHaveBeenCalled();
  });

  it("clicks the shared input when the shell has no interaction bridge", () => {
    installWindow({});
    const input = fileInput();
    openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    expect(input.click).toHaveBeenCalledOnce();
    openDetachedComposerFileChooser(null);
  });

  it("waits for a synchronous hold before clicking, and releases it on change or cancel", () => {
    let acknowledged = false;
    const begin = vi.fn(() => {
      acknowledged = true;
      return true;
    });
    const end = vi.fn();
    const windowEvents = installWindow({ nativeWindowInteraction: { begin, end } });
    const input = fileInput();
    input.click.mockImplementation(() => {
      expect(acknowledged).toBe(true);
    });

    const dispose = openDetachedComposerFileChooser(input as unknown as HTMLInputElement);
    expect(begin).toHaveBeenCalledOnce();
    expect(input.click).toHaveBeenCalledOnce();
    const beginOrder = begin.mock.invocationCallOrder[0];
    const clickOrder = input.click.mock.invocationCallOrder[0];
    if (beginOrder === undefined || clickOrder === undefined) {
      throw new Error("expected the chooser to begin and click");
    }
    expect(beginOrder).toBeLessThan(clickOrder);
    expect(end).not.toHaveBeenCalled();

    windowEvents.emit("focus");
    expect(end).not.toHaveBeenCalled();
    input.emit("change");
    expect(end).toHaveBeenCalledOnce();
    input.emit("change");
    dispose();
    expect(end).toHaveBeenCalledOnce();

    const cancelInput = fileInput();
    openDetachedComposerFileChooser(cancelInput as unknown as HTMLInputElement);
    cancelInput.emit("cancel");
    expect(end).toHaveBeenCalledTimes(2);
    windowEvents.emit("focus");
    expect(end).toHaveBeenCalledTimes(2);
  });

  it("does not claim a hold when begin returns false or throws, and still opens the chooser", () => {
    const end = vi.fn();
    const declined = vi.fn(() => false);
    installWindow({ nativeWindowInteraction: { begin: declined, end } });
    const declinedInput = fileInput();
    openDetachedComposerFileChooser(declinedInput as unknown as HTMLInputElement);
    expect(declinedInput.click).toHaveBeenCalledOnce();
    declinedInput.emit("change");
    declinedInput.emit("cancel");
    expect(end).not.toHaveBeenCalled();

    const failing = vi.fn(() => {
      throw new Error("unavailable");
    });
    installWindow({ nativeWindowInteraction: { begin: failing, end } });
    const failingInput = fileInput();
    expect(() =>
      openDetachedComposerFileChooser(failingInput as unknown as HTMLInputElement),
    ).not.toThrow();
    expect(failingInput.click).toHaveBeenCalledOnce();
    failingInput.emit("change");
    expect(end).not.toHaveBeenCalled();
  });

  it("releases the hold when click throws, and dispose releases one that is still open", () => {
    const end = vi.fn();
    const begin = vi.fn(() => true);
    installWindow({ nativeWindowInteraction: { begin, end } });
    const throwing = fileInput();
    throwing.click.mockImplementation(() => {
      throw new Error("click failed");
    });
    expect(() => openDetachedComposerFileChooser(throwing as unknown as HTMLInputElement)).toThrow(
      "click failed",
    );
    expect(end).toHaveBeenCalledOnce();
    throwing.emit("cancel");
    expect(end).toHaveBeenCalledOnce();

    const open = fileInput();
    const dispose = openDetachedComposerFileChooser(open as unknown as HTMLInputElement);
    expect(end).toHaveBeenCalledOnce();
    dispose();
    expect(end).toHaveBeenCalledTimes(2);
    open.emit("change");
    dispose();
    expect(end).toHaveBeenCalledTimes(2);
  });
});
