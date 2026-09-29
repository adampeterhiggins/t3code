import type { ProjectScriptIcon } from "@t3tools/contracts";
import { conductorScriptEnv, type ConductorRunScript } from "@t3tools/shared/conductorSettings";

/**
 * Conductor run scripts, shared by the web header's Run button and the
 * mobile terminal menu. Each script owns one terminal (`conductor-run-<id>`)
 * so clients can tell it is running and stop it.
 */

export function conductorRunTerminalId(scriptId: string): string {
  return `conductor-run-${scriptId}`.slice(0, 128);
}

/** Conductor names Lucide icons; the scripts menu has a fixed set, so map the common ones. */
export function conductorScriptIcon(icon: string): ProjectScriptIcon {
  switch (icon) {
    case "test-tube":
    case "test-tubes":
    case "flask-conical":
      return "test";
    case "bug":
      return "debug";
    case "wrench":
    case "settings":
      return "configure";
    case "package":
    case "hammer":
    case "rocket":
      return "build";
    default:
      return "play";
  }
}

/** `options.cwd` is relative to the workspace; an absolute path is used as is. */
export function conductorScriptCwd(workspacePath: string, cwd: string | null): string {
  if (cwd === null) return workspacePath;
  if (cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd)) return cwd;
  const separator = workspacePath.includes("\\") && !workspacePath.includes("/") ? "\\" : "/";
  return `${workspacePath.replace(/[\\/]+$/, "")}${separator}${cwd.replace(/^\.[\\/]/, "")}`;
}

/** Everything a client needs to start a Conductor run script in a thread's workspace. */
export function conductorRunScriptLaunch(input: {
  readonly script: ConductorRunScript;
  readonly projectRoot: string;
  /** The thread's worktree, or null when it runs in the project checkout. */
  readonly worktreePath: string | null;
  readonly environment: Readonly<Record<string, string>>;
}) {
  const workspacePath = input.worktreePath ?? input.projectRoot;
  return {
    terminalId: conductorRunTerminalId(input.script.id),
    cwd: conductorScriptCwd(workspacePath, input.script.cwd),
    env: conductorScriptEnv({
      projectRoot: input.projectRoot,
      worktreePath: workspacePath,
      defaultBranch: null,
      environment: input.environment,
    }),
    command: input.script.command,
    icon: conductorScriptIcon(input.script.icon),
  };
}
