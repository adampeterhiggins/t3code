import type { DesktopBridge } from "@t3tools/contracts";

import { isDetachedChatWindow } from "./quickMessageWindow";

type NativeWindowInteractionBridge = NonNullable<DesktopBridge["nativeWindowInteraction"]>;

/**
 * The file input opens Chromium's chooser, which blurs the compact window.
 * `begin` must return before `click` in this turn. Change and cancel release
 * the hold; focus does not, because the chooser can move focus while open.
 */
function readNativeWindowInteraction(): NativeWindowInteractionBridge | null {
  if (!isDetachedChatWindow || typeof window === "undefined") return null;
  const interaction = window.desktopBridge?.nativeWindowInteraction;
  if (
    interaction === undefined ||
    typeof interaction.begin !== "function" ||
    typeof interaction.end !== "function"
  ) {
    return null;
  }
  return interaction;
}

/** Opens the shared composer file input. Returns a dispose that releases a hold still in progress. */
export function openDetachedComposerFileChooser(input: HTMLInputElement | null): () => void {
  if (input === null) return () => undefined;
  const interaction = readNativeWindowInteraction();
  if (interaction === null) {
    input.click();
    return () => undefined;
  }

  let settled = false;
  let held = false;
  const stopListening = () => {
    input.removeEventListener("change", finish);
    input.removeEventListener("cancel", finish);
  };
  const release = () => {
    if (!held) return;
    held = false;
    try {
      interaction.end();
    } catch {
      // Ending the hold must not escape the click or dispose path.
    }
  };
  function finish() {
    if (settled) return;
    settled = true;
    stopListening();
    release();
  }

  input.addEventListener("change", finish);
  input.addEventListener("cancel", finish);
  try {
    held = interaction.begin() === true;
  } catch {
    settled = true;
    stopListening();
    held = false;
    input.click();
    return () => undefined;
  }
  if (!held) {
    settled = true;
    stopListening();
    input.click();
    return () => undefined;
  }
  try {
    input.click();
  } catch (error) {
    finish();
    throw error;
  }
  return finish;
}
