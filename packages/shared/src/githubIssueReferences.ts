import type { RepositoryIdentity } from "@t3tools/contracts";

/**
 * Fork: GitHub issue and pull request references in chat text link to GitHub, so they read like
 * a pasted link. `owner/repo#123` names its repository. `#123` uses the thread's, but only in the user's own
 * text: a thread's agent can work in several repositories, so its bare numbers are not linked. Commit SHAs
 * and mentions stay text: in chat they are usually code, or not about GitHub.
 *
 * Groups: 1 is the `owner/repo` qualifier, if any; 2 is the number. A word, path, or entity
 * character before (`page#1`, `a/b/c#1`, `&#123;`) or a word character after makes it part of
 * something else.
 */
export const GITHUB_ISSUE_REFERENCE =
  /(?<![\w/.&#-])(?:([A-Za-z0-9][\w.-]*\/[\w.-]+))?#([1-9]\d*)(?![\w-])/gu;

/** Cheap check, so text without a reference skips the lookups and the rewrite. */
export function mayHaveGitHubIssueReference(text: string): boolean {
  return /#[1-9]/u.test(text);
}

/**
 * Where a reference points, or null for `#123` without a repository. GitHub redirects an issue
 * URL to the pull request when the number is one.
 */
export function githubIssueReferenceUrl(
  qualifier: string | undefined,
  number: string,
  repositoryUrl: string | null,
): string | null {
  if (qualifier === undefined) {
    return repositoryUrl === null ? null : `${repositoryUrl}/issues/${number}`;
  }
  const origin = repositoryUrl === null ? "https://github.com" : new URL(repositoryUrl).origin;
  return `${origin}/${qualifier}/issues/${number}`;
}

/**
 * The web URL of a project's repository when GitHub hosts it, for resolving `#123`. The server
 * sets `webUrl` when gh opens pull requests somewhere other than the identity's remote.
 */
export function githubRepositoryUrl(
  identity:
    | Pick<RepositoryIdentity, "provider" | "canonicalKey" | "displayName" | "webUrl">
    | null
    | undefined,
): string | null {
  if (identity?.provider !== "github") return null;
  if (identity.webUrl) return identity.webUrl;
  const [host, ...path] = identity.canonicalKey.split("/");
  // The display name keeps the remote's capitalisation; the key is lower-cased.
  const repository = identity.displayName ?? path.join("/");
  return host && repository.includes("/") ? `https://${host}/${repository}` : null;
}
