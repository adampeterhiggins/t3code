import type { RepositoryIdentity } from "@t3tools/contracts";

export interface PullRequestMenuRepository {
  readonly host: string;
  readonly repository: string;
}

/**
 * Repository named by `webUrl` when it is not the identity's own. GitHub sets `webUrl` to the
 * repository gh opens pull requests in, which on a fork can be `origin` while the identity stays
 * `upstream`. A browser URL for the same repository, including a mount prefix, is not one.
 */
export function pullRequestMenuRepository(
  identity: Pick<RepositoryIdentity, "canonicalKey" | "displayName" | "webUrl"> | null | undefined,
): PullRequestMenuRepository | null {
  const webUrl = identity?.webUrl;
  if (webUrl === undefined) return null;
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    return null;
  }
  let repository: string;
  try {
    repository = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/gu, "");
  } catch {
    return null;
  }
  if (!repository.includes("/") || url.host.length === 0) return null;
  const path = repository.toLowerCase();
  const names = [
    identity.canonicalKey.split("/").slice(1).join("/").toLowerCase(),
    identity.displayName?.trim().toLowerCase() ?? "",
  ];
  const sameRepository = names.some(
    (name) => name.includes("/") && (path === name || path.endsWith(`/${name}`)),
  );
  return sameRepository ? null : { host: url.host.toLowerCase(), repository };
}
