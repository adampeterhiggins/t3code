// @effect-diagnostics nodeBuiltinImport:off - Git fixtures inspect exact index bytes and subprocess output.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  collectForkMaintenanceReport,
  formatForkMaintenanceReport,
} from "./fork-maintenance-report.ts";

function repository() {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-report-"));
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
        },
      },
    ).trim();
  const write = (path: string, content: string | Uint8Array) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(cwd, path), content);
  };
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q", "-b", "fork");
    write("shared.ts", "base\n");
    write("other.ts", "base\n");
    commit();
    git("branch", "upstream");
  } catch (error) {
    NodeFS.rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
  return {
    cwd,
    git,
    write,
    commit,
    [Symbol.dispose]: () => NodeFS.rmSync(cwd, { recursive: true, force: true }),
  };
}

it.live("reports growing, retired, added and deleted patches against the integrated baseline", () =>
  Effect.sync(() => {
    using repo = repository();
    repo.write("shared.ts", "base\nfork\n");
    repo.write("fork-only.ts", "new\n");
    repo.write("other.ts", "changed\n");
    const previous = repo.commit();
    repo.write("shared.ts", "base\nfork\nmore\n");
    repo.write("other.ts", "base\n");
    repo.commit();
    const report = collectForkMaintenanceReport({ cwd: repo.cwd, upstream: "upstream" });
    expect(report.comparison?.commit).toBe(previous);
    expect(report.files).toEqual([
      {
        path: "fork-only.ts",
        ownership: "fork",
        current: { added: 1, deleted: 0 },
        previous: { added: 1, deleted: 0 },
        growth: 0,
        overlapsUpstream: false,
      },
      {
        path: "other.ts",
        ownership: "upstream",
        current: null,
        previous: { added: 1, deleted: 1 },
        growth: -2,
        overlapsUpstream: false,
      },
      {
        path: "shared.ts",
        ownership: "upstream",
        current: { added: 2, deleted: 0 },
        previous: { added: 1, deleted: 0 },
        growth: 1,
        overlapsUpstream: false,
      },
    ]);
    expect(report.merge).toEqual({ status: "clean", conflicts: [] });
    NodeFS.unlinkSync(NodePath.join(repo.cwd, "other.ts"));
    repo.commit();
    expect(
      collectForkMaintenanceReport({
        cwd: repo.cwd,
        upstream: "upstream",
        compare: previous,
      }).files.find((file) => file.path === "other.ts"),
    ).toMatchObject({ current: { added: 0, deleted: 1 }, growth: -1 });
  }),
);

it.live(
  "predicts content and add/add conflicts without changing dirty files, index, refs or worktrees",
  () =>
    Effect.sync(() => {
      using repo = repository();
      repo.write("shared.ts", "fork\n");
      repo.write("collision.ts", "fork addition\n");
      const head = repo.commit();
      repo.git("switch", "-q", "upstream");
      repo.write("shared.ts", "upstream\n");
      repo.write("collision.ts", "upstream addition\n");
      repo.commit();
      repo.git("switch", "-q", "fork");
      repo.write("staged.txt", "staged\n");
      repo.git("add", "staged.txt");
      repo.write("other.ts", "uncommitted\n");
      repo.write("untracked.txt", "keep\n");
      const status = repo.git("status", "--porcelain=v1", "-z");
      const index = NodeFS.readFileSync(NodePath.join(repo.cwd, ".git/index"));
      const refs = repo.git("show-ref");
      const worktrees = repo.git("worktree", "list", "--porcelain");
      const report = collectForkMaintenanceReport({ cwd: repo.cwd, upstream: "upstream" });
      expect(report.head.commit).toBe(head);
      expect(report.merge).toEqual({
        status: "conflicts",
        conflicts: ["collision.ts", "shared.ts"],
      });
      expect(report.files.filter((file) => file.overlapsUpstream).map((file) => file.path)).toEqual(
        ["collision.ts", "shared.ts"],
      );
      expect(repo.git("status", "--porcelain=v1", "-z")).toBe(status);
      expect(NodeFS.readFileSync(NodePath.join(repo.cwd, ".git/index"))).toEqual(index);
      expect(repo.git("show-ref")).toBe(refs);
      expect(repo.git("worktree", "list", "--porcelain")).toBe(worktrees);
      expect(NodeFS.readFileSync(NodePath.join(repo.cwd, "other.ts"), "utf8")).toBe(
        "uncommitted\n",
      );
      expect(NodeFS.readFileSync(NodePath.join(repo.cwd, "untracked.txt"), "utf8")).toBe("keep\n");
    }),
);

it.live("compares each snapshot with its own upstream baseline across an upstream merge", () =>
  Effect.sync(() => {
    using repo = repository();
    repo.write("shared.ts", "base\nfork\n");
    const previous = repo.commit();
    repo.git("switch", "-q", "upstream");
    repo.write("upstream-only.ts", "upstream\n");
    const upstream = repo.commit();
    repo.git("switch", "-q", "fork");
    repo.git("merge", "--no-ff", "-qm", "sync", "upstream");
    const report = collectForkMaintenanceReport({
      cwd: repo.cwd,
      upstream: "upstream",
      compare: previous,
    });
    expect(report.head.integratedUpstream).toBe(upstream);
    expect(report.comparison?.integratedUpstream).not.toBe(upstream);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({ path: "shared.ts", growth: 0 });
  }),
);

it.live("preserves unusual paths and reports binary size as unknown", () =>
  Effect.sync(() => {
    using repo = repository();
    const path = "tabs\tand\n雪|<file>.ts";
    repo.write(path, "fork\n");
    repo.write("binary.bin", new Uint8Array([0, 1, 2]));
    repo.commit();
    const report = collectForkMaintenanceReport({ cwd: repo.cwd, upstream: "upstream" });
    expect(report.files.find((file) => file.path === path)).toMatchObject({
      current: { added: 1, deleted: 0 },
      growth: 1,
    });
    expect(report.files.find((file) => file.path === "binary.bin")).toMatchObject({
      current: { added: null, deleted: null },
      growth: null,
    });
    const markdown = formatForkMaintenanceReport(report);
    expect(markdown).toContain("&#124;&lt;file&gt;");
    expect(markdown).not.toContain("<file>");
    expect(markdown).toContain("binary");
  }),
);

it.live("reports a root commit without inventing growth and fails on missing refs", () =>
  Effect.sync(() => {
    using repo = repository();
    const report = collectForkMaintenanceReport({ cwd: repo.cwd, upstream: "upstream" });
    expect(report.comparison).toBeNull();
    expect(report.files).toEqual([]);
    expect(report.merge.status).toBe("clean");
    expect(formatForkMaintenanceReport(report)).toContain("Growth unavailable");
    expect(() => collectForkMaintenanceReport({ cwd: repo.cwd, upstream: "missing-ref" })).toThrow(
      "rev-parse failed",
    );
  }),
);

it.live("runs the CLI as JSON and rejects invalid limits and comparison refs", () =>
  Effect.sync(() => {
    using repo = repository();
    const script = NodeURL.fileURLToPath(new URL("./fork-maintenance-report.ts", import.meta.url));
    const run = (...args: string[]) =>
      NodeChildProcess.spawnSync(process.execPath, [script, "--upstream", "upstream", ...args], {
        cwd: repo.cwd,
        encoding: "utf8",
      });
    const result = run("--json");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      comparison: null,
      files: [],
      merge: { status: "clean" },
    });
    const invalidLimit = run("--limit", "0");
    expect(invalidLimit.status).toBe(1);
    expect(invalidLimit.stderr).toContain("positive integer");
    expect(run("--compare", "missing-ref").status).toBe(1);
  }),
);
