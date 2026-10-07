// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the helper under test is synchronous.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";

import { DESKTOP_UPDATE_RESTART_MARKER_FILE } from "@t3tools/contracts";

import { SERVICE_STATE_FILE, SERVICE_STOP_MARKER_FILE } from "./serviceProtocol.ts";
import { updateRestartPendingSync } from "./updateHandoff.ts";

function runtimeDir(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-update-restart-"));
  const runtime = NodePath.join(dir, "runtime");
  NodeFS.mkdirSync(runtime);
  return runtime;
}

it("sees a fresh desktop update marker", () => {
  const runtime = runtimeDir();
  NodeFS.writeFileSync(NodePath.join(runtime, DESKTOP_UPDATE_RESTART_MARKER_FILE), "");
  expect(updateRestartPendingSync(NodePath.dirname(runtime))).toBe(true);
});

it("ignores a stale desktop update marker", () => {
  const runtime = runtimeDir();
  const marker = NodePath.join(runtime, DESKTOP_UPDATE_RESTART_MARKER_FILE);
  NodeFS.writeFileSync(marker, "");
  const stale = new Date(Date.now() - 5 * 60_000);
  NodeFS.utimesSync(marker, stale, stale);
  expect(updateRestartPendingSync(NodePath.dirname(runtime))).toBe(false);
});

it("sees a pending service update and ignores an explicit stop", () => {
  const runtime = runtimeDir();
  const baseDir = NodePath.dirname(runtime);
  NodeFS.writeFileSync(
    NodePath.join(runtime, SERVICE_STATE_FILE),
    JSON.stringify({ update: { status: "pending" } }),
  );
  expect(updateRestartPendingSync(baseDir)).toBe(true);
  NodeFS.writeFileSync(NodePath.join(runtime, SERVICE_STOP_MARKER_FILE), "");
  expect(updateRestartPendingSync(baseDir)).toBe(false);
});
