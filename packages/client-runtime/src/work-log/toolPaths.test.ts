import { describe, expect, it } from "vite-plus/test";

import { resolveToolPath, toolEntryShowsPathBreadcrumbs, toolPathTextParts } from "./toolPaths.ts";

const path = "/Users/adam/.t3/worktrees/fd-questionnaire/style-all/scripts/parity/compare_reads.py";

describe("tool path breadcrumbs", () => {
  it("separates a different T3 worktree from its file path without losing the full target", () => {
    expect(resolveToolPath(path, "/repo/main")).toEqual({
      absolutePath: path,
      rootLabel: "style-all",
      project: "fd-questionnaire",
      external: false,
      repository: false,
      segments: ["scripts", "parity", "compare_reads.py"],
    });
  });

  it("uses recorded roots for custom directories and branches containing slashes", () => {
    const target = "/checkouts/feature/report/src/index.ts";
    expect(
      resolveToolPath(target, "/repo", [
        { path: "/checkouts", label: "parent", project: null },
        { path: "/checkouts/feature/report", label: "feature/report", project: "Reports" },
      ]),
    ).toMatchObject({
      absolutePath: target,
      rootLabel: "feature/report",
      project: "Reports",
      segments: ["src", "index.ts"],
    });
  });

  it("handles Windows case and mixed separators while copying the original spelling", () => {
    const target = "C:\\Checkouts\\Report\\src\\index.ts";
    expect(
      resolveToolPath(target, "c:/repo", [
        { path: "c:/checkouts/report", label: "report", project: "Reports" },
      ]),
    ).toMatchObject({ absolutePath: target, rootLabel: "report", segments: ["src", "index.ts"] });
  });

  it("recognizes UNC targets without turning them into local paths", () => {
    const target = "\\\\host\\share\\report\\a.ts";
    expect(
      resolveToolPath(target, "C:\\repo", [
        { path: "\\\\host\\share\\report", label: "report", project: null },
      ]),
    ).toMatchObject({ absolutePath: target, rootLabel: "report", segments: ["a.ts"] });
  });

  it("does not confuse a directory prefix with a worktree root", () => {
    expect(
      resolveToolPath("/work/report-old/a.ts", "/repo", [
        { path: "/work/report", label: "report", project: null },
      ]),
    ).toMatchObject({ external: true, rootLabel: "External" });
  });

  it("resolves relative file targets only when their workspace is known", () => {
    expect(resolveToolPath("src/a.ts", "/repo")).toMatchObject({
      absolutePath: "/repo/src/a.ts",
      rootLabel: "repo",
      segments: ["src", "a.ts"],
    });
    expect(resolveToolPath("src/a.ts", null)).toBeNull();
    expect(resolveToolPath("../other/a.ts", "/repo")).toBeNull();
    expect(resolveToolPath("/repo/../other/a.ts", "/repo")).toBeNull();
  });

  it("shows a linked repository clone as its own root", () => {
    expect(resolveToolPath(".context/fd-manager/src/Truncatable.tsx", "/repo")).toMatchObject({
      absolutePath: "/repo/.context/fd-manager/src/Truncatable.tsx",
      rootLabel: "fd-manager",
      repository: true,
      segments: ["src", "Truncatable.tsx"],
    });
    expect(
      resolveToolPath("/Users/adam/.t3/worktrees/t3code/feature/.context/api/a.ts", "/repo"),
    ).toMatchObject({ rootLabel: "api", project: "t3code", repository: true, segments: ["a.ts"] });
    expect(resolveToolPath("/repo/.context", "/repo")).toMatchObject({
      rootLabel: "repo",
      repository: false,
      segments: [".context"],
    });
    expect(resolveToolPath("/repo/src/.context/api/a.ts", "/repo")).toMatchObject({
      repository: false,
    });
  });

  it("recognizes a private agent checkout before its parent workspace", () => {
    expect(resolveToolPath("/repo/.claude/worktrees/agent-123/src/a.ts", "/repo")).toMatchObject({
      rootLabel: "agent-123",
      segments: ["src", "a.ts"],
    });
  });
});

describe("tool label path tokens", () => {
  it.each([
    `Read ${path}`,
    `read_file ${path}`,
    `Read: ${path}`,
    `Edit ${path}`,
    `Search in ${path}`,
    `python '${path}' --check`,
  ])("keeps provider-neutral surrounding text in %s", (label) => {
    const parts = toolPathTextParts(label, "/repo");
    expect(parts.filter((part) => "path" in part)).toEqual([
      { path: resolveToolPath(path, "/repo") },
    ]);
    expect(parts[0]).toEqual({ text: label.slice(0, label.indexOf(path)).replace(/'$/, "") });
  });

  it("handles multiple targets and quoted paths with spaces", () => {
    const label = 'cp "/custom worktrees/report/a.ts" /tmp/a.ts';
    const parts = toolPathTextParts(label, "/repo", [
      { path: "/custom worktrees/report", label: "report", project: null },
    ]);
    expect(parts.filter((part) => "path" in part).map((part) => part.path.absolutePath)).toEqual([
      "/custom worktrees/report/a.ts",
      "/tmp/a.ts",
    ]);
    expect(parts[0]).toEqual({ text: "cp " });
  });

  it("uses a structured path to preserve an unquoted filename containing spaces", () => {
    const target = "/custom worktrees/report/src/my file.ts";
    const parts = toolPathTextParts(`Read ${target}`, "/repo", [], [target]);
    expect(parts).toEqual([{ text: "Read " }, { path: resolveToolPath(target, "/repo") }]);
  });

  it("copies the original Windows target even when a provider normalizes its label", () => {
    const target = "C:\\Worktrees\\Report\\a.ts";
    const parts = toolPathTextParts("Read C:/Worktrees/Report/a.ts", "C:/repo", [], [target]);
    expect(parts).toEqual([{ text: "Read " }, { path: resolveToolPath(target, "C:/repo") }]);
  });

  it.each([
    "https://example.com/a.ts",
    "Search https://example.com/a.ts",
    "src/a.ts",
    "--flag=value",
    "file:///tmp/a.ts",
  ])("leaves non-target text alone: %s", (label) => {
    expect(toolPathTextParts(label, "/repo")).toEqual([{ text: label }]);
  });
});

describe("tool rows that show path breadcrumbs", () => {
  const entry = {
    id: "1",
    createdAt: "2026-10-06T00:00:00.000Z",
    tone: "tool",
  } as const;

  it("keeps shell commands verbatim but breadcrumbs file targets", () => {
    expect(
      toolEntryShowsPathBreadcrumbs({
        ...entry,
        label: `python3 - <<'PY' ${path}`,
        itemType: "command_execution",
        command: `python3 - <<'PY' ${path}`,
      }),
    ).toBe(false);
    expect(
      toolEntryShowsPathBreadcrumbs({ ...entry, label: `Read ${path}`, requestKind: "file-read" }),
    ).toBe(true);
  });
});
