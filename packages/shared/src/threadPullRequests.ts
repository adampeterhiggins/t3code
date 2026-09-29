import type {
  RepositoryIdentity,
  SourceControlProviderKind,
  ThreadLinkedPullRequest,
  ThreadPullRequestKey,
  ThreadPullRequestLink,
} from "@t3tools/contracts";

import { pullRequestHostOf } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "./changeRequestUrl.ts";
import { canonicalRepositoryKey, sourceControlRepositorySelector } from "./sourceControl.ts";

type ThreadPullRequestKeySource = ThreadPullRequestKey & {
  readonly authority?: string;
  readonly url?: string;
};

/** Normalize stored links, recovering Forgejo HTTP ports from old links' URLs. */
export function normalizeThreadPullRequestKey(
  key: ThreadPullRequestKeySource,
): ThreadPullRequestKey {
  const parsed = key.url === undefined ? null : parseChangeRequestUrl(key.url);
  const authority =
    key.authority ??
    (parsed?.repository === key.repository.trim().toLowerCase() && parsed.number === key.number
      ? parsed.authority
      : undefined);
  const canonical = canonicalRepositoryKey(
    `${(authority ?? key.host).trim().toLowerCase()}/${key.repository.trim().toLowerCase()}`,
  );
  const separator = canonical.indexOf("/");
  return {
    host: canonical.slice(0, separator),
    repository: canonical.slice(separator + 1),
    number: key.number,
  };
}

/** Legacy Azure selectors omit the organization and project; recover those from the PR URL. */
export function legacyThreadPullRequestKey(
  linked: Pick<ThreadLinkedPullRequest, "repository" | "number" | "url">,
  fallbackHost?: string,
): ThreadPullRequestKey {
  const parsed = parseChangeRequestUrl(linked.url);
  if (parsed !== null && parsed.number === linked.number) {
    const canonical = canonicalRepositoryKey(`${parsed.host}/${parsed.repository}`);
    if (parsed.authority !== undefined || canonical.startsWith("dev.azure.com/")) {
      return normalizeThreadPullRequestKey(parsed);
    }
  }
  let host = fallbackHost;
  if (host === undefined) {
    try {
      host = new URL(linked.url).hostname;
    } catch {
      host = "unknown";
    }
  }
  return {
    host: host.trim().toLowerCase() || "unknown",
    repository: linked.repository.trim().toLowerCase(),
    number: linked.number,
  };
}

/** Identity comparison for links: host-level, case-insensitive on host and repository. */
export function threadPullRequestKeysEqual(
  left: ThreadPullRequestKeySource,
  right: ThreadPullRequestKeySource,
): boolean {
  return threadPullRequestKeyOf(left) === threadPullRequestKeyOf(right);
}

export function threadPullRequestKeyOf(key: ThreadPullRequestKeySource): string {
  const normalized = normalizeThreadPullRequestKey(key);
  return `${normalized.host}/${normalized.repository}#${normalized.number}`;
}

/** Links a user should see. Tombstoned stack members stay in the array only so the
 * sync reactor does not re-add them. */
export function visibleThreadPullRequests(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<ThreadPullRequestLink> {
  return links.filter((link) => link.source !== "stack-dismissed");
}

function isOpen(link: ThreadPullRequestLink): boolean {
  // Unsynced links are treated as open: they were just linked, and hiding them
  // behind a terminal PR until the first sync would make the link look lost.
  return link.snapshot === null || link.snapshot.state === "open";
}

function latestUpdatedAt(link: ThreadPullRequestLink): number {
  const value = link.snapshot?.updatedAt ?? link.linkedAt;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** The single pull request a one-slot surface (sidebar badge, tab icon, copy link) shows. */
export type ThreadCurrentPullRequest =
  | { readonly kind: "single"; readonly link: ThreadPullRequestLink }
  | {
      readonly kind: "stack";
      readonly open: ReadonlyArray<ThreadPullRequestLink>;
      /** Highest layer of the open set; the one "View PR" and copy-link target. */
      readonly top: ThreadPullRequestLink;
    };

/**
 * Prefer open work and the highest open layer within a chain. A completed chain still
 * points at its top; unrelated terminal links use the most recently updated request.
 */
export function resolveThreadCurrentPullRequest(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ThreadCurrentPullRequest | null {
  const visible = visibleThreadPullRequests(links);
  if (visible.length === 0) return null;
  const open = visible.filter(isOpen);
  if (open.length === 1) return { kind: "single", link: open[0]! };
  const chains = resolveThreadPullRequestChains(visible);
  if (open.length > 1) {
    // `.reverse()` on a copy, not `.toReversed()`: this runs on Hermes, which has no ES2023
    // array methods, and a TypeError here is fatal on every mobile launch that renders a stack.
    const openChains = chains
      .map((chain) => [...chain.layers].reverse().filter(isOpen))
      .filter((layers) => layers.length > 0)
      .sort(
        (left, right) =>
          Math.max(...right.map((link) => Date.parse(link.linkedAt))) -
          Math.max(...left.map((link) => Date.parse(link.linkedAt))),
      );
    const ordered = openChains.flat();
    return { kind: "stack", open: ordered, top: ordered[0]! };
  }
  if (chains.length === 1) {
    return { kind: "single", link: chains[0]!.layers.at(-1)! };
  }
  const terminal = [...visible].sort(
    (left, right) => latestUpdatedAt(right) - latestUpdatedAt(left),
  );
  return { kind: "single", link: terminal[0]! };
}

/** The one link a legacy `linkedPullRequest` consumer should see, or null. */
export function resolveThreadCurrentPullRequestLink(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ThreadPullRequestLink | null {
  const current = resolveThreadCurrentPullRequest(links);
  if (current === null) return null;
  return current.kind === "single" ? current.link : current.top;
}

/** Legacy clients can only route links belonging to the thread's own repository. */
export function legacyLinkedPullRequestOf(
  links: ReadonlyArray<ThreadPullRequestLink>,
  projectId: ThreadLinkedPullRequest["projectId"],
  identity: RepositoryIdentity | null | undefined,
): ThreadLinkedPullRequest | null {
  if (!identity) return null;
  // A local-path remote has no host segment and no provider, so there is no host to match.
  const host = pullRequestHostOf(identity, identity.provider as SourceControlProviderKind);
  if (typeof host !== "string") return null;
  const repository = sourceControlRepositorySelector(identity);
  if (repository === null) return null;
  const azureKey =
    identity.provider === "azure-devops"
      ? canonicalRepositoryKey(identity.canonicalKey.toLowerCase())
      : null;
  const link = resolveThreadCurrentPullRequestLink(
    links.filter((link) => {
      if (azureKey !== null) {
        const key = legacyThreadPullRequestKey(link, link.host);
        return canonicalRepositoryKey(`${key.host}/${key.repository}`) === azureKey;
      }
      const parsed = parseChangeRequestUrl(link.url);
      if (parsed?.authority !== undefined) {
        try {
          const remote = new URL(identity.locator.remoteUrl);
          if (remote.protocol === "http:" || remote.protocol === "https:") {
            return (
              parsed.authority === remote.host && parsed.repository === repository.toLowerCase()
            );
          }
        } catch {
          // SSH web ports are resolved by the provider's configured login.
        }
        return parsed.host === host && parsed.repository === repository.toLowerCase();
      }
      return (
        link.host.toLowerCase() === host.toLowerCase() &&
        link.repository.toLowerCase() === repository.toLowerCase()
      );
    }),
  );
  if (link === null) return null;
  return {
    projectId,
    repository: azureKey === null ? link.repository : repository,
    number: link.number,
    url: link.url,
  };
}

export interface ThreadPullRequestChain {
  readonly kind: "native" | "derived";
  /** Bottom to top. */
  readonly layers: ReadonlyArray<ThreadPullRequestLink>;
}

/**
 * Groups a thread's links into stacks. Native stacks come from the host and win; the rest
 * are chained by matching one link's base branch to another's head branch within the same
 * repository. A link that chains to nothing is a one-layer chain.
 */
export function resolveThreadPullRequestChains(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<ThreadPullRequestChain> {
  const visible = visibleThreadPullRequests(links);
  const chains: Array<ThreadPullRequestChain> = [];
  const placed = new Set<string>();

  const nativeStacks = new Map<string, Array<ThreadPullRequestLink>>();
  for (const link of visible) {
    if (link.stack === null) continue;
    const key = normalizeThreadPullRequestKey(link);
    const stackKey = `${key.host}/${key.repository}#stack:${link.stack.id}`;
    const members = nativeStacks.get(stackKey) ?? [];
    members.push(link);
    nativeStacks.set(stackKey, members);
  }
  for (const members of nativeStacks.values()) {
    const order = new Map(members[0]!.stack!.layers.map((layer, index) => [layer.number, index]));
    members.sort((left, right) => (order.get(left.number) ?? 0) - (order.get(right.number) ?? 0));
    for (const member of members) placed.add(threadPullRequestKeyOf(member));
    chains.push({ kind: "native", layers: members });
  }

  const remaining = visible.filter((link) => !placed.has(threadPullRequestKeyOf(link)));
  const branchKey = (link: ThreadPullRequestLink, branch: string) => {
    const key = normalizeThreadPullRequestKey(link);
    return `${key.host}/${key.repository}:${branch}`;
  };
  // Reused head names cannot identify a parent unambiguously.
  const byHead = new Map<string, ThreadPullRequestLink | null>();
  for (const link of remaining) {
    if (link.snapshot === null) continue;
    const key = branchKey(link, link.snapshot.headBranch);
    byHead.set(key, byHead.has(key) ? null : link);
  }
  const hasChild = new Set<string>();
  for (const link of remaining) {
    if (link.snapshot === null) continue;
    const parent = byHead.get(branchKey(link, link.snapshot.baseBranch));
    if (parent != null && parent !== link) hasChild.add(threadPullRequestKeyOf(parent));
  }
  // Walk from each top (a link nothing builds on) down its base chain.
  for (const top of remaining) {
    if (hasChild.has(threadPullRequestKeyOf(top))) continue;
    const layers: Array<ThreadPullRequestLink> = [];
    let cursor: ThreadPullRequestLink | undefined = top;
    while (cursor !== undefined && !placed.has(threadPullRequestKeyOf(cursor))) {
      placed.add(threadPullRequestKeyOf(cursor));
      layers.unshift(cursor);
      cursor =
        cursor.snapshot === null
          ? undefined
          : (byHead.get(branchKey(cursor, cursor.snapshot.baseBranch)) ?? undefined);
    }
    if (layers.length > 0) chains.push({ kind: "derived", layers });
  }
  // Cycles have no top. Keep those links visible without inventing a stack order.
  for (const link of remaining) {
    if (!placed.has(threadPullRequestKeyOf(link))) {
      chains.push({ kind: "derived", layers: [link] });
    }
  }
  return chains;
}

export type ThreadPullRequestBadge = {
  readonly state: "open" | "closed" | "merged" | "draft";
} & (
  | {
      readonly kind: "stack";
      readonly layers: number;
    }
  | { readonly kind: "pull-request"; readonly others: number }
);

/** Aggregate visible links' state for both stacks and unrelated linked counts. */
export function resolveThreadPullRequestBadge(
  pullRequests: ReadonlyArray<ThreadPullRequestLink> | undefined,
): ThreadPullRequestBadge | null {
  const visible = visibleThreadPullRequests(pullRequests ?? []);
  if (visible.length === 0) return null;
  const states = visible.map((link) => link.snapshot?.state ?? "open");
  const state = visible.every((link) => link.snapshot?.state === "open" && link.snapshot.isDraft)
    ? "draft"
    : states.includes("open")
      ? "open"
      : states.every((entry) => entry === "merged")
        ? "merged"
        : "closed";
  const chains = resolveThreadPullRequestChains(visible);
  if (visible.length > 1 && chains.length === 1) {
    return { kind: "stack", layers: visible.length, state };
  }
  return { kind: "pull-request", others: visible.length - 1, state };
}

/** Search terms for visible PR links, including the legacy single-link projection. */
export function threadPullRequestSearchTerms(thread: {
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
}): string[] {
  if (thread.pullRequests !== undefined && thread.pullRequests.length > 0) {
    return visibleThreadPullRequests(thread.pullRequests).flatMap((link) => [
      `#${link.number}`,
      `${link.repository}#${link.number}`,
      link.url,
      link.snapshot?.title ?? "",
    ]);
  }
  const legacy = thread.linkedPullRequest;
  return legacy ? [`#${legacy.number}`, `${legacy.repository}#${legacy.number}`, legacy.url] : [];
}

/** One row of a thread's pull-request list: a link plus how deep it sits under the PR it targets. */
export interface PullRequestListLine {
  readonly link: ThreadPullRequestLink;
  /** 0 when nothing in the set is its base; each PR that builds on another steps in by one. */
  readonly depth: number;
  /** The root of this line's tree, so callers can tell one tree from another. */
  readonly chainKey: string;
  /**
   * Set on the root of a linear stack (every PR has at most one child). A branch — two PRs
   * targeting the same head — is a tree and carries no stack label.
   */
  readonly stack: { readonly kind: ThreadPullRequestChain["kind"]; readonly size: number } | null;
}

interface PullRequestTreeNode {
  readonly link: ThreadPullRequestLink;
  readonly kind: ThreadPullRequestChain["kind"];
  readonly children: PullRequestTreeNode[];
  activity: number;
}

function listActivityAt(link: ThreadPullRequestLink): number {
  const ms = Date.parse(link.snapshot?.updatedAt ?? link.linkedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

function listBranchKey(link: ThreadPullRequestLink, branch: string): string {
  const key = normalizeThreadPullRequestKey(link);
  return `${key.host}/${key.repository}:${branch}`;
}

/** Nodes that sit on a cycle. Edges into the cycle from outside are kept. */
function pullRequestCycleNodes(proposed: ReadonlyMap<string, string>): Set<string> {
  const inCycle = new Set<string>();
  for (const start of proposed.keys()) {
    const seenAt = new Map<string, number>();
    const seen: string[] = [];
    let cursor: string | undefined = start;
    while (cursor !== undefined && !seenAt.has(cursor)) {
      seenAt.set(cursor, seen.length);
      seen.push(cursor);
      cursor = proposed.get(cursor);
    }
    if (cursor === undefined) continue;
    const cycleStart = seenAt.get(cursor) ?? seen.length;
    for (let index = cycleStart; index < seen.length; index += 1) {
      const node = seen[index];
      if (node !== undefined) inCycle.add(node);
    }
  }
  return inCycle;
}

function comparePullRequestNodes(left: PullRequestTreeNode, right: PullRequestTreeNode): number {
  if (left.activity !== right.activity) return right.activity - left.activity;
  return right.link.number - left.link.number;
}

function stampPullRequestActivity(node: PullRequestTreeNode): number {
  let activity = listActivityAt(node.link);
  for (const child of node.children) {
    const childActivity = stampPullRequestActivity(child);
    if (childActivity > activity) activity = childActivity;
  }
  node.activity = activity;
  return activity;
}

function sortPullRequestTree(nodes: PullRequestTreeNode[]) {
  nodes.sort(comparePullRequestNodes);
  for (const node of nodes) sortPullRequestTree(node.children);
}

/** Length of a single path, or null when any PR on it has more than one child. */
function linearStackSize(node: PullRequestTreeNode): number | null {
  let count = 0;
  let cursor: PullRequestTreeNode | undefined = node;
  while (cursor !== undefined) {
    count += 1;
    if (cursor.children.length > 1) return null;
    cursor = cursor.children[0];
  }
  return count > 1 ? count : null;
}

/**
 * Indented rows for a thread's linked pull requests. Children sit under the pull request whose
 * head is their base, so a branch stays one tree instead of being sliced into whichever leaf was
 * linked first. Native stacks keep the host's order and are not re-derived. A fresh update
 * anywhere floats that whole tree, and within a tree the newer branch is listed first.
 */
export function pullRequestListLines(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<PullRequestListLine> {
  const visible = visibleThreadPullRequests(links);
  const parentOf = new Map<string, string | null>();
  const kindOf = new Map<string, ThreadPullRequestChain["kind"]>();
  const placed = new Set<string>();

  const nativeStacks = new Map<string, Array<ThreadPullRequestLink>>();
  for (const link of visible) {
    kindOf.set(threadPullRequestKeyOf(link), "derived");
    if (link.stack === null) continue;
    const key = normalizeThreadPullRequestKey(link);
    const stackKey = `${key.host}/${key.repository}#stack:${link.stack.id}`;
    const members = nativeStacks.get(stackKey) ?? [];
    members.push(link);
    nativeStacks.set(stackKey, members);
  }
  for (const members of nativeStacks.values()) {
    const order = new Map(members[0]!.stack!.layers.map((layer, index) => [layer.number, index]));
    members.sort((left, right) => (order.get(left.number) ?? 0) - (order.get(right.number) ?? 0));
    let previous: string | null = null;
    for (const member of members) {
      const key = threadPullRequestKeyOf(member);
      placed.add(key);
      kindOf.set(key, "native");
      parentOf.set(key, previous);
      previous = key;
    }
  }

  const remaining = visible.filter((link) => !placed.has(threadPullRequestKeyOf(link)));
  const byHead = new Map<string, ThreadPullRequestLink | null>();
  for (const link of remaining) {
    if (link.snapshot === null) continue;
    const key = listBranchKey(link, link.snapshot.headBranch);
    byHead.set(key, byHead.has(key) ? null : link);
  }
  const proposed = new Map<string, string>();
  for (const link of remaining) {
    if (link.snapshot === null) continue;
    const parent = byHead.get(listBranchKey(link, link.snapshot.baseBranch));
    if (parent == null || parent === link) continue;
    proposed.set(threadPullRequestKeyOf(link), threadPullRequestKeyOf(parent));
  }
  const inCycle = pullRequestCycleNodes(proposed);
  for (const link of remaining) {
    const key = threadPullRequestKeyOf(link);
    const parent = proposed.get(key);
    parentOf.set(key, parent === undefined || inCycle.has(key) ? null : parent);
  }

  const nodes = new Map<string, PullRequestTreeNode>();
  for (const link of visible) {
    const key = threadPullRequestKeyOf(link);
    nodes.set(key, {
      link,
      kind: kindOf.get(key) ?? "derived",
      children: [],
      activity: 0,
    });
  }
  const roots: PullRequestTreeNode[] = [];
  for (const link of visible) {
    const key = threadPullRequestKeyOf(link);
    const node = nodes.get(key);
    if (node === undefined) continue;
    const parent = nodes.get(parentOf.get(key) ?? "");
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  for (const root of roots) stampPullRequestActivity(root);
  sortPullRequestTree(roots);

  const lines: PullRequestListLine[] = [];
  const walk = (
    node: PullRequestTreeNode,
    depth: number,
    chainKey: string,
    stack: PullRequestListLine["stack"],
  ) => {
    lines.push({ link: node.link, depth, chainKey, stack });
    for (const child of node.children) walk(child, depth + 1, chainKey, null);
  };
  for (const root of roots) {
    const size = linearStackSize(root);
    walk(
      root,
      0,
      threadPullRequestKeyOf(root.link),
      size === null ? null : { kind: root.kind, size },
    );
  }
  return lines;
}
