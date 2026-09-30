/** Where a saved file ended up: a real path on desktop, or just its name in a browser. */
export type SavedTextFile =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "browser"; readonly fileName: string };

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: ReadonlyArray<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    name: string;
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

/**
 * Saves text on the device running the client, never the server: the native
 * save dialog on desktop, the browser's save picker where it exists (Chromium),
 * and a plain download elsewhere. Resolves null when the user cancels.
 */
export async function saveMarkdownFile(
  fileName: string,
  contents: string,
): Promise<SavedTextFile | null> {
  const bridge = window.desktopBridge;
  if (bridge?.saveTextFile) {
    const path = await bridge.saveTextFile({ defaultFileName: fileName, contents });
    return path === null ? null : { kind: "path", path };
  }

  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { kind: "browser", fileName: handle.name };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    // Revoke after the click has handed the blob to the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return { kind: "browser", fileName };
}

/** Reveals a file saved through the desktop dialog; a no-op anywhere else. */
export function showSavedFileInFolder(path: string): void {
  void window.desktopBridge?.showSavedFileInFolder?.(path);
}
