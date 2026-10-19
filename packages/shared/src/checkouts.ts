import {
  type CheckoutAccess,
  type CheckoutInspectEntry,
  type ComposerContextId,
  type CheckoutContextRecord,
  MAX_LINKED_CHECKOUTS,
  type ThreadLinkedCheckout,
} from "@t3tools/contracts";

/**
 * Checkouts are local folders the user already has: project roots, T3 worktrees,
 * and a path pasted into search. These helpers keep the picker, the thread link,
 * and the provider prompt on one identity, the path.
 */

export interface CheckoutCandidate {
  readonly environmentId: string;
  readonly environmentLabel: string;
  /** False for a checkout on a machine this thread's agent cannot read. */
  readonly selectable: boolean;
  readonly path: string;
  readonly name: string;
  readonly kind: "project" | "worktree";
}

export interface CheckoutLinkCommand {
  readonly type: "link" | "unlink" | "relocate";
  readonly path: string;
  readonly fromPath?: string;
  readonly name?: string;
  readonly linkedAt?: string;
}

/** Claude is the provider that receives the folder as an extra directory. */
export function checkoutAccessForDriver(driver: string | null | undefined): CheckoutAccess {
  return driver === "claudeAgent" ? "read" : "path-only";
}

/** Trailing slashes do not make a different checkout. */
export function checkoutPathKey(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/u, "");
  return trimmed.length === 0 ? path.trim() : trimmed;
}

export function checkoutPathsEqual(left: string, right: string): boolean {
  return checkoutPathKey(left) === checkoutPathKey(right);
}

export function checkoutDisplayName(path: string): string {
  const key = checkoutPathKey(path);
  const parts = key.split(/[/\\]/u);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part !== undefined && part.length > 0) return part.slice(0, 255);
  }
  return key.slice(0, 255) || "checkout";
}

/**
 * A filesystem path, not a `owner/name` repository query. One slash with no
 * root prefix stays a repository (`acme/app`); a root, a tilde, or two
 * separators is a path.
 */
export function looksLikeCheckoutPath(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("~\\") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    /^[A-Za-z]:[\\/]/u.test(trimmed)
  ) {
    return true;
  }
  return trimmed.split(/[/\\]/u).length - 1 >= 2;
}

function contextIdForPath(path: string): ComposerContextId {
  let hash = 0;
  for (const char of checkoutPathKey(path)) {
    hash = Math.imul(hash, 31) + char.charCodeAt(0);
  }
  const slug = checkoutDisplayName(path)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "")
    .slice(0, 40);
  return `checkout_${slug || "dir"}_${(hash >>> 0).toString(36)}` as ComposerContextId;
}

export function checkoutContextRecord(input: {
  readonly path: string;
  readonly name?: string;
  readonly branch: string | null;
  readonly headSha: string | null;
  readonly changedFiles: number;
  readonly ahead: number;
  readonly access: CheckoutAccess;
  readonly environmentId: CheckoutContextRecord["environmentId"];
}): CheckoutContextRecord {
  const path = checkoutPathKey(input.path);
  const name = (input.name ?? checkoutDisplayName(path)).slice(0, 200);
  return {
    version: 1,
    kind: "checkout",
    contextId: contextIdForPath(path),
    label: name,
    environmentId: input.environmentId,
    path,
    branch: input.branch,
    headSha: input.headSha,
    changedFiles: input.changedFiles,
    ahead: input.ahead,
    access: input.access,
  };
}

/**
 * Project roots and thread worktrees, one row per path. The current environment
 * is selectable; every other connected environment is listed and cannot be chosen.
 */
export function checkoutCandidates(input: {
  readonly currentEnvironmentId: string;
  readonly projects: ReadonlyArray<{
    readonly environmentId: string;
    readonly title: string;
    readonly workspaceRoot: string;
  }>;
  readonly worktrees: ReadonlyArray<{
    readonly environmentId: string;
    readonly worktreePath: string | null;
  }>;
  readonly environmentLabel: (environmentId: string) => string;
}): CheckoutCandidate[] {
  const byKey = new Map<string, CheckoutCandidate>();
  const add = (candidate: Omit<CheckoutCandidate, "environmentLabel" | "selectable">) => {
    const key = `${candidate.environmentId}\0${checkoutPathKey(candidate.path)}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      ...candidate,
      path: checkoutPathKey(candidate.path),
      selectable: candidate.environmentId === input.currentEnvironmentId,
      environmentLabel: input.environmentLabel(candidate.environmentId),
    });
  };
  for (const project of input.projects) {
    if (project.workspaceRoot.trim().length === 0) continue;
    add({
      environmentId: project.environmentId,
      path: project.workspaceRoot,
      name: project.title || checkoutDisplayName(project.workspaceRoot),
      kind: "project",
    });
  }
  for (const worktree of input.worktrees) {
    if (worktree.worktreePath === null || worktree.worktreePath.trim().length === 0) continue;
    add({
      environmentId: worktree.environmentId,
      path: worktree.worktreePath,
      name: checkoutDisplayName(worktree.worktreePath),
      kind: "worktree",
    });
  }
  return [...byKey.values()];
}

export function rankCheckoutCandidates<T extends { readonly path: string; readonly name: string }>(
  candidates: ReadonlyArray<T>,
  query: string,
  recentRank: ReadonlyMap<string, number>,
): T[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  const matched = candidates.filter((candidate) => {
    if (words.length === 0) return true;
    const text = `${candidate.name} ${candidate.path}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return matched.sort((left, right) => {
    const leftRecent = recentRank.get(checkoutPathKey(left.path)) ?? Number.POSITIVE_INFINITY;
    const rightRecent = recentRank.get(checkoutPathKey(right.path)) ?? Number.POSITIVE_INFINITY;
    if (leftRecent !== rightRecent) return leftRecent - rightRecent;
    return left.name.localeCompare(right.name);
  });
}

export function linkedCheckoutsAfter(
  current: ReadonlyArray<ThreadLinkedCheckout>,
  command: CheckoutLinkCommand,
): { readonly changed: boolean; readonly links: ReadonlyArray<ThreadLinkedCheckout> } {
  const path = checkoutPathKey(command.path);
  if (command.type === "unlink") {
    const links = current.filter((link) => !checkoutPathsEqual(link.path, path));
    return { changed: links.length !== current.length, links };
  }
  if (command.type === "relocate") {
    const fromPath = command.fromPath === undefined ? "" : checkoutPathKey(command.fromPath);
    const source = current.find((link) => checkoutPathsEqual(link.path, fromPath));
    if (source === undefined || current.some((link) => checkoutPathsEqual(link.path, path))) {
      return { changed: false, links: current };
    }
    return {
      changed: true,
      links: current.map((link) =>
        link === source
          ? { ...link, path, name: (command.name ?? checkoutDisplayName(path)).slice(0, 255) }
          : link,
      ),
    };
  }
  if (current.some((link) => checkoutPathsEqual(link.path, path))) {
    return { changed: false, links: current };
  }
  if (current.length >= MAX_LINKED_CHECKOUTS || command.linkedAt === undefined) {
    return { changed: false, links: current };
  }
  return {
    changed: true,
    links: [
      ...current,
      {
        path,
        name: (command.name ?? checkoutDisplayName(path)).slice(0, 255),
        linkedAt: command.linkedAt,
      },
    ],
  };
}

export function sameCheckoutRepository(
  left: Pick<CheckoutInspectEntry, "exists" | "isRepo" | "repositoryKey"> | undefined,
  right: Pick<CheckoutInspectEntry, "exists" | "isRepo" | "repositoryKey"> | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  return (
    left.exists &&
    right.exists &&
    left.isRepo &&
    right.isRepo &&
    left.repositoryKey !== null &&
    left.repositoryKey === right.repositoryKey
  );
}

/** Paths Claude should be allowed to read for this turn. Other providers get the path in text only. */
export function checkoutDirectoriesForTurn(input: {
  readonly driver: string | null | undefined;
  readonly linked: ReadonlyArray<{ readonly path: string }>;
  readonly records: ReadonlyArray<{ readonly kind: string; readonly path?: string }>;
}): ReadonlyArray<string> {
  if (checkoutAccessForDriver(input.driver) !== "read") return [];
  const paths = new Set<string>();
  for (const link of input.linked) paths.add(checkoutPathKey(link.path));
  for (const record of input.records) {
    if (record.kind === "checkout" && record.path !== undefined) {
      paths.add(checkoutPathKey(record.path));
    }
  }
  return [...paths];
}

/**
 * Linked checkouts the message does not already reference, so the agent still
 * hears about them. Unlinking stops this for later turns.
 */
export function formatLinkedCheckoutPrompt(
  links: ReadonlyArray<Pick<ThreadLinkedCheckout, "name" | "path">>,
  records: ReadonlyArray<{ readonly kind: string; readonly path?: string }>,
  access: CheckoutAccess,
): string {
  const referenced = new Set(
    records.flatMap((record) =>
      record.kind === "checkout" && record.path !== undefined ? [checkoutPathKey(record.path)] : [],
    ),
  );
  const pending = links.filter((link) => !referenced.has(checkoutPathKey(link.path)));
  if (pending.length === 0) return "";
  const accessLine =
    access === "read"
      ? "You have read access to these folders for this turn."
      : "The path is shared only; you may not be able to read the folder directly.";
  const rows = pending.map((link) => `- ${link.name}: ${link.path}`);
  return ["Linked checkouts:", ...rows, accessLine].join("\n");
}

export function formatCheckoutPayload(record: CheckoutContextRecord): string {
  const lines = [`checkout: ${record.label}`, `path: ${record.path}`];
  lines.push(record.branch === null ? "branch: detached HEAD" : `branch: ${record.branch}`);
  if (record.headSha !== null) lines.push(`head: ${record.headSha}`);
  lines.push(
    record.changedFiles === 0
      ? "changes: clean working tree when referenced"
      : `changes: ${record.changedFiles} uncommitted file${record.changedFiles === 1 ? "" : "s"} when referenced`,
  );
  lines.push(
    record.access === "read" ? "access: read access for this turn" : "access: path shared only",
  );
  return lines.join("\n");
}
