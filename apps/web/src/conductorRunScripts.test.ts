import { describe, expect, it } from "vite-plus/test";

import { conductorScriptCwd } from "./conductorRunScripts";

describe("conductorScriptCwd", () => {
  it("resolves options.cwd against the workspace", () => {
    expect(conductorScriptCwd("/repo/wt", null)).toBe("/repo/wt");
    expect(conductorScriptCwd("/repo/wt/", "./apps/web")).toBe("/repo/wt/apps/web");
    expect(conductorScriptCwd("C:\\repo\\wt", "apps\\web")).toBe("C:\\repo\\wt\\apps\\web");
    expect(conductorScriptCwd("/repo/wt", "/opt/tool")).toBe("/opt/tool");
  });
});
