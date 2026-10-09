import {
  contextRepositoryRemoteKey,
  type ContextRepositoryCandidate,
  type ContextRepositoryClone,
  type ContextRepositoryGitStatus,
  type ContextRepositoryOutcome,
} from "@t3tools/contracts";

export { repositoryContextRecord } from "@t3tools/shared/integrationContextRecords";

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

const MAX_SHOWN_CANDIDATES = 50;

/**
 * `org/` or `org/partial-name` searches that owner; anything else searches the configured owners,
 * highest priority first.
 */
export function splitContextRepositoryOwnerQuery(
  query: string,
  defaultOwners: ReadonlyArray<string>,
): { readonly owners: ReadonlyArray<string>; readonly filter: string } {
  const match = /^([A-Za-z0-9_.-]+)\/(.*)$/.exec(query);
  if (match) return { owners: [match[1]!], filter: match[2]!.toLowerCase() };
  return { owners: defaultOwners, filter: query.toLowerCase() };
}

/** The configured owners, falling back to the single owner a server older than the list sends. */
export function configuredContextRepositoryOwners(settings: {
  readonly contextRepositoryOwners: ReadonlyArray<string>;
  readonly contextRepositoryOwner: string;
}): ReadonlyArray<string> {
  if (settings.contextRepositoryOwners.length > 0 || settings.contextRepositoryOwner.length === 0) {
    return settings.contextRepositoryOwners;
  }
  return [settings.contextRepositoryOwner];
}

/** The `contextRepositories.list` input for these owners; null when there are none. */
export function contextRepositoryListInput(owners: ReadonlyArray<string>) {
  const [owner] = owners;
  if (owner === undefined) return null;
  return owners.length === 1 ? { owner } : { owner, owners };
}

/** Names a list of owners for picker copy: `acme`, `acme and me`, `acme, me and 2 more`. */
export function describeContextRepositoryOwners(owners: ReadonlyArray<string>): string {
  if (owners.length <= 2) return owners.join(" and ");
  return owners.length === 3
    ? `${owners[0]}, ${owners[1]} and ${owners[2]}`
    : `${owners[0]}, ${owners[1]} and ${owners.length - 2} more`;
}

/**
 * Display labels keyed by `nameWithOwner`: the bare repository name, with the owner in brackets
 * only when another listed owner has a repository of the same name, e.g. `api (acme)`.
 */
export function contextRepositoryCandidateLabels(
  candidates: ReadonlyArray<Pick<ContextRepositoryCandidate, "name" | "nameWithOwner">>,
): ReadonlyMap<string, string> {
  const owners = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    const owner = candidate.nameWithOwner.split("/")[0]!.toLowerCase();
    owners.set(name, (owners.get(name) ?? new Set()).add(owner));
  }
  return new Map(
    candidates.map((candidate) => [
      candidate.nameWithOwner,
      (owners.get(candidate.name.toLowerCase())?.size ?? 0) > 1
        ? `${candidate.name} (${candidate.nameWithOwner.split("/")[0]})`
        : candidate.name,
    ]),
  );
}

/** Recently attached first, then the server's order (owner priority, then most recently pushed). */
export function rankContextRepositoryCandidates(
  candidates: ReadonlyArray<ContextRepositoryCandidate>,
  filter: string,
  recentRank: ReadonlyMap<string, number>,
): ReadonlyArray<ContextRepositoryCandidate> {
  return candidates
    .filter(
      (candidate) =>
        filter.length === 0 ||
        candidate.name.toLowerCase().includes(filter) ||
        (candidate.description?.toLowerCase().includes(filter) ?? false),
    )
    .sort(
      (left, right) =>
        (recentRank.get(left.nameWithOwner) ?? Infinity) -
        (recentRank.get(right.nameWithOwner) ?? Infinity),
    )
    .slice(0, MAX_SHOWN_CANDIDATES);
}

/**
 * A pasted URL, or an `owner/repo` the shown list does not (yet) contain, is still attachable.
 * Null when the query is neither, or names a repository already listed.
 */
export function pastedContextRepositoryEntry(
  query: string,
  shown: ReadonlyArray<Pick<ContextRepositoryCandidate, "nameWithOwner">>,
): { readonly nameWithOwner: string; readonly remoteUrl: string } | null {
  const pasted = parseRepositoryInput(query);
  if (!pasted) return null;
  const listed = shown.some(
    (candidate) => candidate.nameWithOwner.toLowerCase() === pasted.nameWithOwner.toLowerCase(),
  );
  if (pasted.remoteUrl === null && listed) return null;
  return {
    nameWithOwner: pasted.nameWithOwner,
    remoteUrl: pasted.remoteUrl ?? `https://github.com/${pasted.nameWithOwner}`,
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
