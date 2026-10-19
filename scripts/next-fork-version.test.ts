import { describe, expect, it } from "vite-plus/test";

import { nextForkVersion } from "./next-fork-version.ts";

describe("nextForkVersion", () => {
  it.each([
    ["0.10.0", "0.9.99", "20261019", "0.10.0-fork.20261019.1"],
    ["0.1.0", "0.0.149", "20261019", "0.1.0-fork.20261019.1"],
    ["0.1.0", "0.1.0-fork.20261019.1", "20261019", "0.1.0-fork.20261019.2"],
    ["0.1.0", "0.1.0-fork.20261019.9", "20261019", "0.1.0-fork.20261019.10"],
    ["0.1.0", "0.1.0-fork.20261018.4", "20261019", "0.1.0-fork.20261019.1"],
    ["0.1.1", "0.1.0-fork.20261019.4", "20261019", "0.1.1-fork.20261019.1"],
    ["0.1.0", "0.0.99-fork.20261020.4", "20261019", "0.1.0-fork.20261019.1"],
  ])("advances %s from %s on %s to %s", (upstream, previous, date, expected) => {
    expect(nextForkVersion(upstream, previous, date)).toBe(expected);
  });

  it.each([
    ["0.1.0", "0.1.0"],
    ["0.1.0", "0.1.1-fork.20261018.1"],
    ["0.1.0", "0.1.0-fork.20261020.1"],
  ])("refuses an update from %s based on newer release %s", (upstream, previous) => {
    expect(() => nextForkVersion(upstream, previous, "20261019")).toThrow("downgrade");
  });

  it.each([
    ["0.1.0-nightly.1", "0.0.149", "20261019"],
    ["0.1.0", "broken", "20261019"],
    ["0.1.0", "0.0.149", "2026-10-19"],
    ["0.1.0", "0.1.0-fork.20261019.9007199254740991", "20261019"],
  ])("rejects invalid version inputs (%s, %s, %s)", (upstream, previous, date) => {
    expect(() => nextForkVersion(upstream, previous, date)).toThrow();
  });
});
