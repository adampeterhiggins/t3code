import { FolderClosedIcon, TerminalIcon } from "lucide-react";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CursorIcon, FileExplorerIcon, FinderIcon, VisualStudioCode } from "../Icons";
import { resolveOpenInOptions, resolveOpenInEditorIds } from "./OpenInPicker";
import { shouldShowOpenInPicker } from "./OpenInPicker.logic";

describe("shouldShowOpenInPicker", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");

  it("shows the picker for projects in the primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("shows the picker for remote environments in deep-link mode", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(true);
  });

  it("shows the picker's unavailable state for remote environments without an SSH route", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId: null,
        remoteOpenMode: "remote-unavailable",
      }),
    ).toBe(true);
  });

  it("hides the picker for non-primary local backends", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(false);
  });
});

describe("resolveOpenInOptions", () => {
  it.each([
    ["MacIntel", "Finder", FinderIcon],
    ["Win32", "File Explorer", FileExplorerIcon],
    ["Linux x86_64", "Files", FolderClosedIcon],
  ] as const)("includes the file manager with its icon on %s", (platform, label, Icon) => {
    expect(resolveOpenInOptions(platform, ["cursor", "vscode", "file-manager"])).toEqual([
      expect.objectContaining({ value: "cursor", label: "Cursor" }),
      expect.objectContaining({ value: "vscode", label: "VS Code" }),
      expect.objectContaining({ value: "file-manager", label, Icon }),
    ]);
  });

  it("omits the file manager when unavailable or using remote editors", () => {
    expect(resolveOpenInOptions("MacIntel", ["vscode"])).toEqual([
      expect.objectContaining({ value: "vscode" }),
    ]);
    expect(resolveOpenInOptions("MacIntel", [])).toEqual([]);
  });
});

it("offers configured applications only on an executable environment route", () => {
  const customEditors = [
    { id: "custom:typora" as const, label: "Typora", command: "open", args: ["-a", "Typora"] },
  ];
  expect(resolveOpenInOptions("MacIntel", ["custom:typora"], customEditors)).toEqual([
    expect.objectContaining({ value: "custom:typora", label: "Typora" }),
  ]);
  expect(resolveOpenInOptions("MacIntel", ["vscode"], customEditors)).toEqual([
    expect.objectContaining({ value: "vscode" }),
  ]);
});

it("keeps host applications available remotely without inventing SSH support", () => {
  const customEditors = [
    { id: "custom:typora" as const, label: "Typora", command: "open", args: [] },
  ];
  expect(resolveOpenInEditorIds("remote-links", ["idea"], ["vscode"], customEditors)).toEqual([
    "vscode",
    "custom:typora",
  ]);
  expect(resolveOpenInEditorIds("remote-unavailable", ["idea"], ["vscode"], customEditors)).toEqual(
    ["custom:typora"],
  );
});

it.each([
  [undefined, FolderClosedIcon, "generic"],
  ["folder", FolderClosedIcon, "generic"],
  ["cursor", CursorIcon, "brand"],
  ["vscode", VisualStudioCode, "brand"],
  ["terminal", TerminalIcon, "generic"],
] as const)("uses the configured custom application icon %s", (icon, Icon, kind) => {
  const customEditors = [
    {
      id: "custom:opencursor" as const,
      label: "opencursor",
      command: "opencursor",
      args: [],
      ...(icon ? { icon } : {}),
    },
  ];
  expect(resolveOpenInOptions("MacIntel", ["custom:opencursor"], customEditors)).toEqual([
    { value: "custom:opencursor", label: "opencursor", Icon, kind },
  ]);
});
