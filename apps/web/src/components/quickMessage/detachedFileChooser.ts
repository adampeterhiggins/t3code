import { isDetachedChatWindow } from "./quickMessageWindow";

interface NativeWindowInteraction {
  readonly begin: () => Promise<void>;
  readonly end: () => Promise<void>;
}

/**
 * Electron's interaction counter wraps `dialog.showOpenDialog` only. The
 * composer's `<input type="file">` opens Chromium's chooser, which still
 * blurs the compact window. An optional `desktopBridge.nativeWindowInteraction`
 * `{ begin, end }` holds that counter from the click until change, cancel, or
 * focus return. Older shells omit it; the click still uses this input.
 *
 * `begin` is not awaited before `click`. Awaiting an IPC round-trip spends the
 * user activation Chromium requires to open the chooser. Blur can still win
 * that race until begin is synchronous in the main process.
 */
function isNativeWindowInteraction(value: unknown): value is NativeWindowInteraction {
  if (typeof value !== "object" || value === null) return false;
  if (!("begin" in value) || !("end" in value)) return false;
  return typeof value.begin === "function" && typeof value.end === "function";
}

function readNativeWindowInteraction(): NativeWindowInteraction | null {
  if (!isDetachedChatWindow || typeof window === "undefined") return null;
  const bridge: unknown = window.desktopBridge;
  if (typeof bridge !== "object" || bridge === null || !("nativeWindowInteraction" in bridge)) {
    return null;
  }
  return isNativeWindowInteraction(bridge.nativeWindowInteraction)
    ? bridge.nativeWindowInteraction
    : null;
}

/** Opens the shared composer file input, bracketing a native interaction when the shell provides one. */
export function openDetachedComposerFileChooser(input: HTMLInputElement | null): void {
  if (input === null) return;
  const interaction = readNativeWindowInteraction();
  if (interaction === null) {
    input.click();
    return;
  }
  let ended = false;
  let begun = false;
  const stopListening = () => {
    input.removeEventListener("change", end);
    input.removeEventListener("cancel", end);
    window.removeEventListener("focus", end);
  };
  const finish = () => {
    if (!begun) return;
    void interaction.end().catch(() => undefined);
  };
  function end() {
    if (ended) return;
    ended = true;
    stopListening();
    finish();
  }
  input.addEventListener("change", end);
  input.addEventListener("cancel", end);
  window.addEventListener("focus", end);
  const pendingBegin = interaction.begin();
  input.click();
  void pendingBegin.then(
    () => {
      begun = true;
      if (ended) finish();
    },
    () => {
      ended = true;
      stopListening();
    },
  );
}
