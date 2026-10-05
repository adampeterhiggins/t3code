import { describe, expect, it } from "vite-plus/test";

import { findAcpModeByAliases } from "./AcpModeAliases.ts";

const MODES = [
  { id: "default", name: "Default" },
  { id: "acceptEdits", name: "Accept Edits" },
  { id: "bypassPermissions", name: "Bypass Permissions" },
];

describe("findAcpModeByAliases", () => {
  it("prefers exact id or name matches in alias order", () => {
    expect(findAcpModeByAliases(MODES, ["missing", "acceptedits", "default"])?.id).toBe(
      "acceptEdits",
    );
    expect(findAcpModeByAliases(MODES, ["bypass permissions"])?.id).toBe("bypassPermissions");
  });

  it("falls back to substring matches after every exact alias misses", () => {
    expect(findAcpModeByAliases(MODES, ["bypass", "default"])?.id).toBe("default");
    expect(findAcpModeByAliases(MODES, ["bypass"])?.id).toBe("bypassPermissions");
  });

  it("returns undefined when nothing matches", () => {
    expect(findAcpModeByAliases(MODES, ["plan"])).toBeUndefined();
  });
});
