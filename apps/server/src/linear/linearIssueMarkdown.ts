import { type IssueComment, renderIssueMarkdown } from "../issueMarkdown.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ISSUE_URL_PATH_PATTERN = /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/|$)/;

/**
 * Returns the issue identifier (`ENG-123`) named by `input`, which may be a
 * bare identifier or a linear.app issue URL. Anything else is free text.
 */
export function parseLinearIssueRef(input: string): string | null {
  const trimmed = input.trim();
  if (IDENTIFIER_PATTERN.test(trimmed)) return trimmed.toUpperCase();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.hostname !== "linear.app") return null;
  const match = ISSUE_URL_PATH_PATTERN.exec(url.pathname);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export interface LinearIssueDetail {
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly description: string | null;
  readonly stateName: string;
  readonly priorityLabel: string | null;
  readonly assigneeName: string | null;
  readonly teamName: string | null;
  readonly projectName: string | null;
  readonly labels: ReadonlyArray<string>;
  readonly parent: { readonly identifier: string; readonly title: string } | null;
  readonly children: ReadonlyArray<{
    readonly identifier: string;
    readonly title: string;
    readonly stateName: string;
  }>;
  readonly links: ReadonlyArray<{ readonly title: string; readonly url: string }>;
  readonly comments: ReadonlyArray<IssueComment>;
}

function renderHeader(issue: LinearIssueDetail): string {
  const facts = [
    `State: ${issue.stateName}`,
    issue.priorityLabel ? `Priority: ${issue.priorityLabel}` : null,
    issue.assigneeName ? `Assignee: ${issue.assigneeName}` : null,
    issue.teamName ? `Team: ${issue.teamName}` : null,
    issue.projectName ? `Project: ${issue.projectName}` : null,
    issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : null,
    issue.parent ? `Parent: ${issue.parent.identifier} ${issue.parent.title}` : null,
  ].filter((fact) => fact !== null);
  return [`# ${issue.identifier}: ${issue.title}`, issue.url, "", ...facts].join("\n");
}

/** Renders an issue as the markdown an agent receives; see `renderIssueMarkdown`. */
export function renderLinearIssueMarkdown(issue: LinearIssueDetail, maxChars: number): string {
  const children =
    issue.children.length > 0
      ? [
          "## Sub-issues",
          ...issue.children.map((c) => `- ${c.identifier} ${c.title} (${c.stateName})`),
        ].join("\n")
      : null;
  const links =
    issue.links.length > 0
      ? ["## Links", ...issue.links.map((link) => `- [${link.title}](${link.url})`)].join("\n")
      : null;
  return renderIssueMarkdown(
    {
      header: renderHeader(issue),
      description: issue.description,
      sections: [children, links].filter((part) => part !== null),
      comments: issue.comments,
    },
    maxChars,
  );
}
