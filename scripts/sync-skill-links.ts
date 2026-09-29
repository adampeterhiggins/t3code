#!/usr/bin/env node
// Mirrors .agents/skills into each tool's skills directory as one symlink per
// skill (../../.agents/skills/<name>). .agents/skills is the source of truth.
//
//   node scripts/sync-skill-links.ts          regenerate the mirrors
//   node scripts/sync-skill-links.ts --check  fail if any mirror is out of sync

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const MIRRORS = [".claude/skills", ".cursor/skills", ".grok/skills"];

const root = NodePath.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const skills = NodeFS.readdirSync(NodePath.join(root, ".agents/skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const problems: string[] = [];

// rmSync follows symlinks, so a dangling link would survive it.
const remove = (path: string) =>
  NodeFS.lstatSync(path).isSymbolicLink()
    ? NodeFS.unlinkSync(path)
    : NodeFS.rmSync(path, { recursive: true });

for (const mirror of MIRRORS) {
  const mirrorPath = NodePath.join(root, mirror);
  // A whole-directory symlink (the old layout) must become a real directory.
  if (NodeFS.lstatSync(mirrorPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    if (check) problems.push(`${mirror} is a symlink, expected a directory of skill links`);
    else NodeFS.unlinkSync(mirrorPath);
  }
  if (!check) NodeFS.mkdirSync(mirrorPath, { recursive: true });
  const existing = NodeFS.existsSync(mirrorPath) ? NodeFS.readdirSync(mirrorPath) : [];

  for (const entry of existing) {
    if (skills.includes(entry)) continue;
    if (check) problems.push(`${mirror}/${entry} has no matching skill in .agents/skills`);
    else remove(NodePath.join(mirrorPath, entry));
  }

  for (const skill of skills) {
    const link = NodePath.join(mirrorPath, skill);
    const target = `../../.agents/skills/${skill}`;
    const stat = NodeFS.lstatSync(link, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() && NodeFS.readlinkSync(link) === target) continue;
    if (check) {
      problems.push(`${mirror}/${skill} should be a symlink to ${target}`);
      continue;
    }
    if (stat) remove(link);
    NodeFS.symlinkSync(target, link);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[skills] ${problem}`);
  console.error("[skills] Run `vp run skills:sync` and commit the result.");
  process.exit(1);
}

console.log(
  `[skills] ${check ? "OK" : "Synced"}: ${MIRRORS.join(", ")} mirror ${skills.length} skills.`,
);
