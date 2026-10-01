import { createGitHubIssueEnvironmentAtoms } from "@t3tools/client-runtime/state/github-issues";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";

import { connectionAtomRuntime } from "../connection/runtime";

export const githubIssueEnvironment = createGitHubIssueEnvironmentAtoms(connectionAtomRuntime);

/** Whether a project's repository is hosted on GitHub, so its issues can be listed with `gh`. */
export function isGitHubProject(
  project: Pick<EnvironmentProject, "repositoryIdentity"> | null | undefined,
): boolean {
  return project?.repositoryIdentity?.provider === "github";
}
