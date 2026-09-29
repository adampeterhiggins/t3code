import { describe, expect, it } from "vite-plus/test";

import { conductorRunScriptLaunch, conductorScriptCwd } from "./conductorRunScripts.ts";

describe("conductorScriptCwd", () => {
  it("resolves options.cwd against the workspace", () => {
    expect(conductorScriptCwd("/repo/wt", null)).toBe("/repo/wt");
    expect(conductorScriptCwd("/repo/wt/", "./apps/web")).toBe("/repo/wt/apps/web");
    expect(conductorScriptCwd("C:\\repo\\wt", "apps\\web")).toBe("C:\\repo\\wt\\apps\\web");
    expect(conductorScriptCwd("/repo/wt", "/opt/tool")).toBe("/opt/tool");
  });
});

describe("conductorRunScriptLaunch", () => {
  it("runs in the thread's worktree with Conductor's variables", () => {
    const launch = conductorRunScriptLaunch({
      script: {
        id: "dev",
        name: "dev",
        command: "./scripts/conductor.sh start --open",
        icon: "play",
        default: true,
        cwd: "ui",
      },
      projectRoot: "/repo",
      worktreePath: "/repo-worktrees/lisbon",
      environment: { API_URL: "x" },
    });
    expect(launch).toMatchObject({
      terminalId: "conductor-run-dev",
      cwd: "/repo-worktrees/lisbon/ui",
      command: "./scripts/conductor.sh start --open",
      icon: "play",
      env: {
        API_URL: "x",
        CONDUCTOR_ROOT_PATH: "/repo",
        CONDUCTOR_WORKSPACE_PATH: "/repo-worktrees/lisbon",
        CONDUCTOR_WORKSPACE_NAME: "lisbon",
      },
    });
  });
});
