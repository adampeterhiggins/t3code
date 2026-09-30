import {
  contextRepositoryRemoteKey,
  type ComposerContextId,
  type ContextRepositoryClone,
  type ContextRepositoryGitStatus,
  type ContextRepositoryOutcome,
  type RepositoryContextRecord,
} from "@t3tools/contracts";

/** The chip record for one repository to clone into the workspace's context folder. */
export function repositoryContextRecord(input: {
  readonly nameWithOwner: string;
  readonly remoteUrl: string;
}): RepositoryContextRecord {
  const nameWithOwner = input.nameWithOwner.trim().slice(0, 255);
  const slug = nameWithOwner
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  const repositoryName = nameWithOwner.split("/").at(-1) ?? nameWithOwner;
  const directoryName = repositoryName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+$/, "repo");
  return {
    version: 1,
    kind: "repository",
    contextId: `repository_${slug || "repo"}` as ComposerContextId,
    label: nameWithOwner.slice(0, 200),
    nameWithOwner,
    remoteUrl: input.remoteUrl,
    directoryName: directoryName || "repo",
  };
}

/**
 * Reads what a user pasted into the picker: `owner/repo`, an https or ssh clone URL, or a
 * browser URL to the repository. Null when it does not look like any of those.
 */
export function parseRepositoryInput(
  raw: string,
): { readonly nameWithOwner: string; readonly remoteUrl: string | null } | null {
  const text = raw.trim();
  if (text.length === 0 || /\s/.test(text)) return null;
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(text);
  if (shorthand) return { nameWithOwner: `${shorthand[1]}/${shorthand[2]}`, remoteUrl: null };
  const scp = /^[^@/\s]+@([^:/\s]+):(.+?)(?:\.git)?\/?$/.exec(text);
  if (scp) {
    const path = scp[2]!.replace(/^\/+/, "");
    return path.includes("/") ? { nameWithOwner: path, remoteUrl: text } : null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
  const segments = url.pathname
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;
  // A browser URL like github.com/acme/api/tree/main still means acme/api on GitHub.
  const isGitHub = url.hostname.toLowerCase() === "github.com";
  const path = (isGitHub ? segments.slice(0, 2) : segments).join("/");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return {
    nameWithOwner: path,
    remoteUrl: isGitHub ? `https://github.com/${path}` : url.toString().replace(/\/+$/, ""),
  };
}

/** The workspace clone that already holds this remote, if any. */
export function findContextRepositoryClone(
  clones: ReadonlyArray<ContextRepositoryClone>,
  remoteUrl: string,
): ContextRepositoryClone | null {
  const key = contextRepositoryRemoteKey(remoteUrl);
  return (
    clones.find(
      (clone) => clone.remoteUrl !== null && contextRepositoryRemoteKey(clone.remoteUrl) === key,
    ) ?? null
  );
}

/** Compact git state for a chip or picker row: `main · 3 behind · 2 changed`. */
export function describeContextRepositoryGitStatus(git: ContextRepositoryGitStatus): string {
  const parts = [git.branch ?? `detached at ${git.headSha?.slice(0, 7) ?? "unknown"}`];
  if (git.ahead > 0) parts.push(`${git.ahead} ahead`);
  if (git.behind > 0) parts.push(`${git.behind} behind`);
  if (git.upstream === null) parts.push("no upstream");
  parts.push(git.changedFiles === 0 ? "clean" : `${git.changedFiles} changed`);
  return parts.join(" · ");
}

export function contextRepositoryOutcomeLabel(outcome: ContextRepositoryOutcome): string {
  switch (outcome.status) {
    case "cloned":
      return `Cloned into ${outcome.path}`;
    case "present":
      return `Already in ${outcome.path}`;
    case "conflict":
      return `Not cloned: ${outcome.path} is in the way`;
    case "failed":
      return "Clone failed";
  }
}
