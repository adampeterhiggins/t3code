import { describe, expect, it } from "vite-plus/test";

import { CONDUCTOR_LOCAL_SETTINGS_PATH, CONDUCTOR_SETTINGS_PATH } from "./conductorSettings.ts";
import { conductorEditModel, parseConductorEnvironmentLines } from "./conductorSettingsEditor.ts";

const files = {
  [CONDUCTOR_SETTINGS_PATH]: [
    "[scripts]",
    'setup = "./scripts/setup.sh"',
    'archive = "./scripts/conductor.sh kill"',
    "[environment_variables]",
    'SHARED = "1"',
  ].join("\n"),
  [CONDUCTOR_LOCAL_SETTINGS_PATH]: '[scripts]\nsetup = "./scripts/setup.sh --deps"\n',
};

describe("conductorEditModel", () => {
  it("shows the local file's overrides over the repository's values", () => {
    const model = conductorEditModel({ files, worktreeInclude: null, target: "local" });
    expect(model.targetPath).toBe(CONDUCTOR_LOCAL_SETTINGS_PATH);
    expect(model.setup).toMatchObject({
      value: "./scripts/setup.sh --deps",
      placeholder: "./scripts/setup.sh",
      isSet: true,
      statuses: [{ text: "Set in settings.local.toml, overriding settings.toml.", tone: "muted" }],
    });
    expect(model.archive).toMatchObject({
      value: "",
      placeholder: "./scripts/conductor.sh kill",
      isSet: false,
      statuses: [{ text: "From settings.toml.", tone: "muted" }],
    });
    expect(model.filesToCopy.placeholder).toBe(".env*");
    expect(model.environment.statuses).toEqual([
      { text: "Also set by other settings files: SHARED.", tone: "muted" },
    ]);
  });

  it("flags local overrides, the project's own setup action, and .worktreeinclude", () => {
    const model = conductorEditModel({
      files,
      worktreeInclude: ".env.local\n",
      target: "shared",
      setupActionName: "Install",
    });
    expect(model.setup.value).toBe("./scripts/setup.sh");
    expect(model.setup.statuses.map((status) => status.tone)).toEqual(["warning", "warning"]);
    expect(model.filesToCopy).toMatchObject({
      value: ".env.local\n",
      lockedByWorktreeInclude: true,
    });
    expect(model.environment.value).toBe("SHARED=1");
  });

  it("disables editing a file that is not valid TOML", () => {
    const model = conductorEditModel({
      files: { [CONDUCTOR_LOCAL_SETTINGS_PATH]: "[scripts\n" },
      worktreeInclude: null,
      target: "local",
    });
    expect(model.targetInvalid).toBe(true);
    expect(model.otherInvalidFiles).toEqual([]);
  });
});

describe("parseConductorEnvironmentLines", () => {
  it("reads KEY=value lines and names the first bad one", () => {
    expect(parseConductorEnvironmentLines("# note\nA=1\n\nB = two=2\n")).toEqual({
      A: "1",
      B: "two=2",
    });
    expect(parseConductorEnvironmentLines("A=1\nnot a pair")).toBe(
      "“not a pair” is not a KEY=value line.",
    );
  });
});
