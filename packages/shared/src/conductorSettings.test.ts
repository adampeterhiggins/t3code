import { describe, expect, it } from "vite-plus/test";
import { parse as parseToml } from "smol-toml";

import {
  CONDUCTOR_LOCAL_SETTINGS_PATH,
  CONDUCTOR_SETTINGS_PATH,
  conductorPort,
  conductorScriptEnv,
  resolveConductorSettings,
  updateConductorSettingsToml,
} from "./conductorSettings.ts";

const ORCHESTRA = `"$schema" = "https://conductor.build/schemas/settings.repo.schema.json"

[git]
worktree_push_auto_setup_remote = true

[scripts]
setup = "./scripts/setup.sh --setup-workspace --package-managers --conductor-deps"
archive = "./scripts/conductor.sh kill"
run_mode = "concurrent"

[scripts.run.dev]
command = "./scripts/conductor.sh start --open"
default = true
icon = "play"
`;

describe("resolveConductorSettings", () => {
  it("layers local settings over shared ones and ignores legacy conductor.json once migrated", () => {
    const settings = resolveConductorSettings({
      files: {
        "conductor.json": '{ "scripts": { "setup": "legacy" } }',
        [CONDUCTOR_SETTINGS_PATH]: ORCHESTRA,
        [CONDUCTOR_LOCAL_SETTINGS_PATH]: '[scripts]\nsetup = "mine"\n',
      },
      worktreeInclude: null,
    });
    expect(settings).toMatchObject({
      setupScript: "mine",
      archiveScript: "./scripts/conductor.sh kill",
      includePatterns: ".env*",
      configured: true,
      invalidFiles: [],
    });
  });

  it("reports broken files and leaves unconfigured repositories alone", () => {
    expect(
      resolveConductorSettings({
        files: { [CONDUCTOR_SETTINGS_PATH]: "[scripts\n" },
        worktreeInclude: null,
      }),
    ).toMatchObject({
      configured: false,
      includePatterns: null,
      invalidFiles: [CONDUCTOR_SETTINGS_PATH],
    });
    expect(resolveConductorSettings({ files: {}, worktreeInclude: "certs/**\n" })).toMatchObject({
      configured: false,
      includePatterns: "certs/**\n",
    });
  });
});

describe("run scripts", () => {
  it("resolves orchestra's dev script", () => {
    const settings = resolveConductorSettings({
      files: { [CONDUCTOR_SETTINGS_PATH]: ORCHESTRA },
      worktreeInclude: null,
    });
    expect(settings.runMode).toBe("concurrent");
    expect(settings.runScripts).toEqual([
      {
        id: "dev",
        name: "dev",
        command: "./scripts/conductor.sh start --open",
        icon: "play",
        default: true,
        cwd: null,
      },
    ]);
  });

  it("merges scripts by id across files, puts the default first, and honors hide", () => {
    const settings = resolveConductorSettings({
      files: {
        [CONDUCTOR_SETTINGS_PATH]: [
          "[scripts]",
          'run_mode = "nonconcurrent"',
          "[scripts.run.test-watch]",
          'command = "pnpm test"',
          'args = ["--watch", "it\'s"]',
          'icon = "test-tube"',
          "[scripts.run.web]",
          'command = "pnpm dev"',
          "default = true",
          "[scripts.run.cloud-only]",
          'command = "deploy"',
          'available_in = ["cloud"]',
          "[scripts.run.worker]",
          'command = "pnpm worker"',
          'options = { cwd = "apps/worker" }',
        ].join("\n"),
        [CONDUCTOR_LOCAL_SETTINGS_PATH]: [
          "[scripts.run.web]",
          'command = "pnpm dev --host 127.0.0.1"',
          "[scripts.run.worker]",
          "hide = true",
        ].join("\n"),
      },
      worktreeInclude: null,
    });
    expect(settings.runMode).toBe("nonconcurrent");
    expect(settings.runScripts).toEqual([
      {
        id: "web",
        name: "web",
        command: "pnpm dev --host 127.0.0.1",
        icon: "play",
        default: true,
        cwd: null,
      },
      {
        id: "test-watch",
        name: "test watch",
        command: "pnpm test --watch 'it'\\''s'",
        icon: "test-tube",
        default: false,
        cwd: null,
      },
    ]);
  });

  it("reads the legacy single run script", () => {
    expect(
      resolveConductorSettings({
        files: { "conductor.json": '{ "scripts": { "run": "npm run dev" } }' },
        worktreeInclude: null,
      }).runScripts,
    ).toMatchObject([{ id: "run", command: "npm run dev", default: true }]);
  });

  it("gives each workspace a stable block of ports and its Conductor variables", () => {
    const port = conductorPort("/repo/worktrees/lisbon");
    expect(port).toBe(conductorPort("/repo/worktrees/lisbon"));
    expect(port % 10).toBe(0);
    expect(port).toBeGreaterThanOrEqual(30_000);
    expect(port).toBeLessThan(50_000);
    expect(
      conductorScriptEnv({
        projectRoot: "/repo",
        worktreePath: "/repo/worktrees/lisbon/",
        defaultBranch: "main",
        environment: { API_URL: "x", CONDUCTOR_ROOT_PATH: "ignored" },
      }),
    ).toMatchObject({
      API_URL: "x",
      CONDUCTOR_ROOT_PATH: "/repo",
      CONDUCTOR_WORKSPACE_NAME: "lisbon",
      CONDUCTOR_DEFAULT_BRANCH: "main",
      CONDUCTOR_IS_LOCAL: "1",
    });
  });
});

describe("updateConductorSettingsToml", () => {
  it("edits the supported keys and keeps everything else", () => {
    const next = updateConductorSettingsToml(ORCHESTRA, {
      setup: "  pnpm install  ",
      archive: null,
      fileIncludeGlobs: ".env.local\nconfig/local.json",
      environment: { API_URL: "http://localhost:3000" },
    });
    expect(parseToml(next)).toEqual({
      $schema: "https://conductor.build/schemas/settings.repo.schema.json",
      git: { worktree_push_auto_setup_remote: true },
      scripts: {
        setup: "pnpm install",
        run_mode: "concurrent",
        run: {
          dev: { command: "./scripts/conductor.sh start --open", default: true, icon: "play" },
        },
      },
      file_include_globs: ".env.local\nconfig/local.json",
      environment_variables: { API_URL: "http://localhost:3000" },
    });
  });

  it("starts a new file with the schema and drops tables that end up empty", () => {
    const created = updateConductorSettingsToml(null, { setup: "make setup" });
    expect(parseToml(created)).toEqual({
      $schema: "https://conductor.build/schemas/settings.repo.schema.json",
      scripts: { setup: "make setup" },
    });
    expect(parseToml(updateConductorSettingsToml(created, { setup: null }))).toEqual({
      $schema: "https://conductor.build/schemas/settings.repo.schema.json",
    });
  });

  it("keeps environment sections when replacing the top-level variables", () => {
    const raw = '[environment_variables]\nA = "1"\n[environment_variables.local]\nB = "2"\n';
    expect(parseToml(updateConductorSettingsToml(raw, { environment: { C: "3" } }))).toEqual({
      environment_variables: { C: "3", local: { B: "2" } },
    });
  });

  it("refuses to rewrite a file it cannot parse", () => {
    expect(() => updateConductorSettingsToml("[scripts\n", { setup: "x" })).toThrow();
  });
});
