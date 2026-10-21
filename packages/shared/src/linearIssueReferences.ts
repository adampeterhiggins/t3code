/**
 * Fork: bare Linear issue identifiers (`ENG-123`) in chat text become links to the connected
 * workspace, so they read like a pasted issue link. Only the workspace's real team keys match,
 * so `UTF-8` or `ISO-8601` stay text, and only in upper case: the lower-case form is a branch
 * name or slug (`eng-123-fix-login`).
 */
export interface LinearIssueReferences {
  readonly workspaceUrlKey: string;
  /** Global: matches every identifier of the workspace's teams in a run of text. */
  readonly pattern: RegExp;
}

// A word or hyphen on either side makes the identifier part of something longer.
const IDENTIFIER_SHAPE = /(?<![\w-])[A-Z][A-Z0-9]*-\d+(?![\w-])/u;
const TEAM_KEY = /^[A-Z][A-Z0-9]*$/u;

/** Cheap check, so text without an identifier-shaped word skips the Linear lookups. */
export function mayHaveLinearIssueReference(text: string): boolean {
  return IDENTIFIER_SHAPE.test(text);
}

export function linearIssueReferences(
  workspaceUrlKey: string,
  teamKeys: ReadonlyArray<string>,
): LinearIssueReferences | null {
  const keys = teamKeys.filter((key) => TEAM_KEY.test(key));
  if (workspaceUrlKey === "" || keys.length === 0) return null;
  return {
    workspaceUrlKey,
    pattern: new RegExp(`(?<![\\w-])(?:${keys.join("|")})-\\d+(?![\\w-])`, "gu"),
  };
}

/** Linear redirects the slug-less form to the issue's full URL. */
export function linearIssueReferenceUrl(workspaceUrlKey: string, identifier: string): string {
  return `https://linear.app/${encodeURIComponent(workspaceUrlKey)}/issue/${identifier}`;
}
