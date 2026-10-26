#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Read-only Git reporting CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

interface PatchSize {
  readonly added: number | null;
  readonly deleted: number | null;
}

interface Revision {
  readonly commit: string;
  readonly integratedUpstream: string;
}

export interface ForkMaintenanceReport {
  readonly head: Revision;
  readonly upstream: string;
  readonly comparison: Revision | null;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly ownership: "upstream" | "fork";
    readonly current: PatchSize | null;
    readonly previous: PatchSize | null;
    readonly growth: number | null;
    readonly overlapsUpstream: boolean;
  }>;
  readonly merge: {
    readonly status: "clean" | "conflicts";
    readonly conflicts: ReadonlyArray<string>;
  };
}

function git(cwd: string, args: ReadonlyArray<string>, accepted = [0]) {
  const result = NodeChildProcess.spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
  });
  if (result.error) throw result.error;
  if (result.status === null || !accepted.includes(result.status)) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return { output: result.stdout, status: result.status };
}

function resolveCommit(cwd: string, ref: string) {
  return git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).output.trim();
}

function revision(cwd: string, commit: string, upstream: string): Revision {
  const bases = git(cwd, ["merge-base", "--all", commit, upstream]).output.trim().split("\n");
  if (bases.length !== 1 || !bases[0]) {
    throw new Error("The revisions need exactly one merge base for patch accounting.");
  }
  return { commit, integratedUpstream: bases[0] };
}

function patches(cwd: string, snapshot: Revision) {
  const output = git(cwd, [
    "diff",
    "--numstat",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    snapshot.integratedUpstream,
    snapshot.commit,
    "--",
  ]).output;
  return new Map(
    output
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const firstTab = entry.indexOf("\t");
        const secondTab = entry.indexOf("\t", firstTab + 1);
        const added = entry.slice(0, firstTab);
        const deleted = entry.slice(firstTab + 1, secondTab);
        return [
          entry.slice(secondTab + 1),
          {
            added: added === "-" ? null : Number(added),
            deleted: deleted === "-" ? null : Number(deleted),
          },
        ] as const;
      }),
  );
}

function total(size: PatchSize | null) {
  return size === null
    ? 0
    : size.added === null || size.deleted === null
      ? null
      : size.added + size.deleted;
}

export function collectForkMaintenanceReport(options: {
  readonly cwd: string;
  readonly head?: string;
  readonly upstream?: string;
  readonly compare?: string;
}): ForkMaintenanceReport {
  const { cwd } = options;
  const upstream = resolveCommit(cwd, options.upstream ?? "upstream/main");
  const head = revision(cwd, resolveCommit(cwd, options.head ?? "HEAD"), upstream);
  const parent =
    options.compare === undefined
      ? git(cwd, ["rev-list", "--parents", "-n", "1", head.commit]).output.trim().split(" ")[1]
      : resolveCommit(cwd, options.compare);
  const comparison = parent ? revision(cwd, parent, upstream) : null;
  const current = patches(cwd, head);
  const previous = comparison ? patches(cwd, comparison) : new Map<string, PatchSize>();
  const upstreamPaths = new Set(
    git(cwd, ["ls-tree", "-r", "--name-only", "-z", head.integratedUpstream])
      .output.split("\0")
      .filter(Boolean),
  );
  const previousUpstreamPaths = comparison
    ? new Set(
        git(cwd, ["ls-tree", "-r", "--name-only", "-z", comparison.integratedUpstream])
          .output.split("\0")
          .filter(Boolean),
      )
    : new Set<string>();
  const upstreamChanges = new Set(
    git(cwd, ["diff", "--name-only", "--no-renames", "-z", head.integratedUpstream, upstream, "--"])
      .output.split("\0")
      .filter(Boolean),
  );
  const files = [...new Set([...current.keys(), ...previous.keys()])].sort().map((path) => {
    const size = current.get(path) ?? null;
    const oldSize = previous.get(path) ?? null;
    const currentTotal = total(size);
    const previousTotal = total(oldSize);
    return {
      path,
      ownership:
        upstreamPaths.has(path) || (size === null && previousUpstreamPaths.has(path))
          ? ("upstream" as const)
          : ("fork" as const),
      current: size,
      previous: oldSize,
      growth:
        comparison === null || currentTotal === null || previousTotal === null
          ? null
          : currentTotal - previousTotal,
      overlapsUpstream: size !== null && upstreamChanges.has(path),
    };
  });
  // merge-tree writes temporary Git objects, but never updates refs, the index or working files.
  const merge = git(
    cwd,
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", head.commit, upstream],
    [0, 1],
  );
  const [tree, ...conflicts] = merge.output.split("\0").filter(Boolean);
  if (
    !tree ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree) ||
    (merge.status === 1 && conflicts.length === 0)
  ) {
    throw new Error("Git did not produce a valid merge preview.");
  }
  return {
    head,
    upstream,
    comparison,
    files,
    merge: {
      status: merge.status === 0 ? "clean" : "conflicts",
      conflicts: [...new Set(conflicts)].sort(),
    },
  };
}

const code = (value: string) =>
  `<code>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("\n", "&#10;").replaceAll("\r", "&#13;")}</code>`;

export function formatForkMaintenanceReport(report: ForkMaintenanceReport, limit = 30) {
  const active = report.files.filter((file) => file.current !== null);
  const upstream = active.filter((file) => file.ownership === "upstream");
  const growing = report.files
    .filter((file) => file.ownership === "upstream" && file.growth !== null && file.growth > 0)
    .sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0) || a.path.localeCompare(b.path));
  const shrinking = upstream
    .filter((file) => file.growth !== null && file.growth < 0)
    .sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0) || a.path.localeCompare(b.path));
  const retired = report.files.filter((file) => file.current === null);
  const overlaps = active.filter((file) => file.overlapsUpstream);
  const lines = [
    "# Fork maintenance report",
    "",
    `Head: ${code(report.head.commit)}. Upstream: ${code(report.upstream)}.`,
    `Integrated upstream baseline: ${code(report.head.integratedUpstream)}.`,
    report.comparison
      ? `Growth compares with ${code(report.comparison.commit)}, using its own upstream baseline ${code(report.comparison.integratedUpstream)}.`
      : "Growth unavailable: this commit has no parent and no comparison was supplied.",
    "",
    `${upstream.length} patched upstream files; ${active.length - upstream.length} fork-added files; ${growing.length} growing patches; ${retired.length} retired patches; ${overlaps.length} paths changed on both sides.`,
    "",
    "Counts are added plus deleted lines, not a measure of complexity. Renames count as deletion/addition. Binary sizes and growth are unknown. All file types, including generated and vendored files, are included.",
    "",
  ];
  function table(title: string, files: typeof report.files) {
    lines.push(
      `## ${title}`,
      "",
      "| Path | Ownership | Added | Deleted | Growth | Both sides |",
      "| --- | --- | ---: | ---: | ---: | --- |",
    );
    for (const file of files.slice(0, limit)) {
      lines.push(
        `| ${code(file.path)} | ${file.ownership} | ${file.current === null ? "0" : (file.current.added ?? "binary")} | ${file.current === null ? "0" : (file.current.deleted ?? "binary")} | ${file.growth === null ? "unknown" : file.growth > 0 ? `+${file.growth}` : file.growth} | ${file.overlapsUpstream ? "yes" : ""} |`,
      );
    }
    if (files.length === 0) lines.push("| None | | | | | |");
    lines.push("", `Showing ${Math.min(files.length, limit)} of ${files.length} paths.`, "");
  }
  table(
    "Patched upstream files",
    [...upstream].sort(
      (a, b) => (total(b.current) ?? -1) - (total(a.current) ?? -1) || a.path.localeCompare(b.path),
    ),
  );
  table("Growing upstream patches", growing);
  table("Shrinking upstream patches", shrinking);
  table(
    "Fork-added files",
    active.filter((file) => file.ownership === "fork"),
  );
  table("Changes on both sides", overlaps);
  table("Retired patches", retired);
  lines.push(
    "## Merge preview",
    "",
    report.merge.status === "clean"
      ? "Git predicts a clean merge."
      : `Git predicts conflicts in ${report.merge.conflicts.length} paths:`,
    "",
  );
  lines.push(...report.merge.conflicts.map((path) => `- ${code(path)}`));
  lines.push(
    "",
    "This preview checks committed revisions only. It does not fetch, merge, stage, change branches or inspect uncommitted edits. A clean merge does not prove that fork behavior survives. JSON output includes every path, including fork-added files.",
  );
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  try {
    const { values } = NodeUtil.parseArgs({
      options: {
        head: { type: "string" },
        upstream: { type: "string" },
        compare: { type: "string" },
        limit: { type: "string", default: "30" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: vp run fork:report [--head HEAD] [--upstream upstream/main] [--compare <ref>] [--limit 30] [--json]\nDefaults to committed HEAD and its first parent. Fetch upstream beforehand. Conflicts are reported without a failure exit; Git/ref errors fail the command.",
      );
    } else {
      const limit = Number(values.limit);
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("--limit must be a positive integer.");
      const report = collectForkMaintenanceReport({ cwd: process.cwd(), ...values });
      console.log(
        values.json ? JSON.stringify(report, null, 2) : formatForkMaintenanceReport(report, limit),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
