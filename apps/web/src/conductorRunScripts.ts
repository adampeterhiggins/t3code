import type { ProjectScriptIcon } from "@t3tools/contracts";

/** Each Conductor run script owns one terminal, so its running state is visible and stoppable. */
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
