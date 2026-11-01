import type { RepositoryIdentity } from "@t3tools/contracts";

/**
 * Fork: `owner/repo#123`, and `#123` in the user's own text, link to GitHub. Group 1 is the
 * optional `owner/repo`, group 2 the number. A word, path, or entity character before
 * (`page#1`, `a/b/c#1`, `&#123;`) or a word character after makes it part of something else.
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

/** The web URL of a project's repository when GitHub hosts it, for resolving `#123`. */
export function githubRepositoryUrl(
  identity:
    | Pick<RepositoryIdentity, "provider" | "canonicalKey" | "displayName">
    | null
    | undefined,
): string | null {
  if (identity?.provider !== "github") return null;
  const [host, ...path] = identity.canonicalKey.split("/");
  // The display name keeps the remote's capitalisation; the key is lower-cased.
  const repository = identity.displayName ?? path.join("/");
  return host && repository.includes("/") ? `https://${host}/${repository}` : null;
}
