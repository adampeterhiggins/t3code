import { describe, expect, it } from "vite-plus/test";

import {
  formatCommandForWorkspace,
  formatPathsForWorkspace,
  formatToolTextForWorkspace,
} from "./commandDisplay.ts";

const root = "/Users/me/.t3/worktrees/app/wt-1";

describe("formatCommandForWorkspace", () => {
  it.each([
    [`cd ${root} && git status`, "git status"],
    [`cd ${root}/ && git status`, "git status"],
    [`cd '${root}' && git status`, "git status"],
    [`cd "${root}"; git status`, "git status"],
    [`cd ${root}\ngit status`, "git status"],
    [`cd -- ${root} && git status`, "git status"],
    [`cd ${root} && cd ${root} && git status`, "git status"],
    [`git status && cd ${root} && make lint`, "git status && make lint"],
    ["cd . && git status --short", "git status --short"],
    [`(cd ${root} && vp test)`, "(vp test)"],
    [`/bin/zsh -lc 'cd ${root} && git status'`, "/bin/zsh -lc 'git status'"],
    [
      `cd ${root} && (uv run pytest tests/unit -q 2>&1 | tail -1); make py-lint`,
      "(uv run pytest tests/unit -q 2>&1 | tail -1); make py-lint",
    ],
  ])("drops cd to the workspace: %s", (command, expected) => {
    expect(formatCommandForWorkspace(command, root)).toBe(expected);
  });

  it.each([
    [`sed -n 1,20p ${root}/src/index.ts`, "sed -n 1,20p src/index.ts"],
    [`rg -n foo '${root}/src' "${root}/docs"`, "rg -n foo 'src' \"docs\""],
    [`git -C ${root} status`, "git -C . status"],
    [`ls ${root}/`, "ls ."],
    [`vp test --root=${root}/apps/web`, "vp test --root=apps/web"],
    [`cd ${root}/packages/core && vp test`, "cd packages/core && vp test"],
  ])("makes workspace paths relative: %s", (command, expected) => {
    expect(formatCommandForWorkspace(command, root)).toBe(expected);
  });

  it("stops rewriting after a cd elsewhere", () => {
    expect(formatCommandForWorkspace(`cd /tmp && cat ${root}/notes.md`, root)).toBe(
      `cd /tmp && cat ${root}/notes.md`,
    );
    expect(
      formatCommandForWorkspace(`cat ${root}/a && cd ${root}/sub && cat ${root}/b`, root),
    ).toBe(`cat a && cd sub && cat ${root}/b`);
  });

  it.each([
    `cat ${root}-other/file`,
    `cat ${root}2/file`,
    `cat /elsewhere${root}/file`,
    "git status",
  ])("leaves unrelated paths alone: %s", (command) => {
    expect(formatCommandForWorkspace(command, root)).toBe(command);
  });

  it("ignores missing and filesystem roots", () => {
    const command = `cd ${root} && git status`;
    expect(formatCommandForWorkspace(command, undefined)).toBe(command);
    expect(formatCommandForWorkspace(command, "/")).toBe(command);
    expect(formatCommandForWorkspace("dir C:\\foo", "C:\\")).toBe("dir C:\\foo");
  });

  it("keeps a command that is only a cd to the workspace", () => {
    expect(formatCommandForWorkspace(`cd ${root}`, root)).toBe("cd .");
  });

  it("matches Windows workspaces case-insensitively", () => {
    expect(
      formatCommandForWorkspace(
        "Set-Location c:\\Users\\me\\repo; Get-Content C:\\Users\\me\\repo\\src\\a.ts",
        "C:\\Users\\me\\repo",
      ),
    ).toBe("Get-Content src\\a.ts");
  });
});

describe("formatPathsForWorkspace", () => {
  it.each([
    [
      `Read: ${root}/src/provider/RuntimeInstructions.ts`,
      "Read: src/provider/RuntimeInstructions.ts",
    ],
    [`Read ${root}/docs/AGENTS.md (321 - 360)`, "Read docs/AGENTS.md (321 - 360)"],
    [`${root}/packages/shared/src/serverSettings.ts`, "packages/shared/src/serverSettings.ts"],
    [`Write: ${root}-other/notes.md`, `Write: ${root}-other/notes.md`],
    ["Read: /tmp/notes.md", "Read: /tmp/notes.md"],
  ])("%s", (text, expected) => {
    expect(formatPathsForWorkspace(text, root)).toBe(expected);
  });
});

describe("formatToolTextForWorkspace", () => {
  it("rewrites tool rows and leaves prose rows alone", () => {
    const text = `Everything below is under ${root}/apps`;
    expect(formatToolTextForWorkspace({ itemType: "file_change" }, text, root)).toBe(
      "Everything below is under apps",
    );
    expect(formatToolTextForWorkspace({}, text, root)).toBe(text);
  });
});
