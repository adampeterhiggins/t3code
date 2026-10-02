import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { CustomEditor, EditorId, resolveFileOpenTarget } from "./editor.ts";

const isEditorId = Schema.is(EditorId);
const isCustomEditor = Schema.is(CustomEditor);
const decodeCustomEditor = Schema.decodeUnknownSync(CustomEditor);

describe("file opening preferences", () => {
  it("uses case-insensitive extension overrides on POSIX and Windows paths", () => {
    const settings = {
      fileOpenDefault: "vscode" as const,
      fileOpenRules: [{ extension: ".md", target: "custom:typora" as const }],
    };
    expect(resolveFileOpenTarget("/project/README.MD", settings)).toBe("custom:typora");
    expect(resolveFileOpenTarget("C:\\project\\notes.md", settings)).toBe("custom:typora");
    expect(resolveFileOpenTarget("/project/index.ts", settings)).toBe("vscode");
    expect(resolveFileOpenTarget("/project/folder.md/Makefile", settings)).toBe("vscode");
  });
  it("can restore the T3 viewer for one extension", () => {
    expect(
      resolveFileOpenTarget("/notes.md", {
        fileOpenDefault: "vscode",
        fileOpenRules: [{ extension: "md", target: "t3" }],
      }),
    ).toBe("t3");
  });
  it("accepts registered application IDs without accepting arbitrary built-in IDs", () => {
    expect(isEditorId("custom:typora")).toBe(true);
    expect(isEditorId("arbitrary")).toBe(false);
    expect(
      isCustomEditor({
        id: "custom:typora",
        label: "Typora",
        command: "open",
        args: ["-a", "Typora"],
      }),
    ).toBe(true);
  });
});

describe("custom application icons", () => {
  const application = {
    id: "custom:opencursor",
    label: "opencursor",
    command: "opencursor",
    args: [],
  };

  it("decodes existing applications without an icon", () => {
    expect(decodeCustomEditor(application)).toEqual(application);
  });

  it.each(["cursor", "vscode", "file-manager", "folder", "terminal", "code", "globe"])(
    "preserves the icon %s when decoding settings",
    (icon) => {
      expect(decodeCustomEditor({ ...application, icon }).icon).toBe(icon);
    },
  );

  it("rejects unregistered icon identifiers and URLs", () => {
    expect(isCustomEditor({ ...application, icon: "custom:other" })).toBe(false);
    expect(isCustomEditor({ ...application, icon: "https://example.com/icon.svg" })).toBe(false);
  });
});
