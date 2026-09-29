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
  readonly comments: ReadonlyArray<{
    readonly author: string;
    readonly createdAt: string;
    readonly body: string;
  }>;
}

const TRUNCATION_MARKER = "\n\n…[truncated]";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= TRUNCATION_MARKER.length) return "";
  return text.slice(0, maxChars - TRUNCATION_MARKER.length).trimEnd() + TRUNCATION_MARKER;
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

function renderComment(comment: LinearIssueDetail["comments"][number]): string {
  return `**${comment.author}** (${comment.createdAt.slice(0, 10)}):\n${comment.body.trim()}`;
}

/**
 * Renders an issue as the markdown an agent receives. Within `maxChars`, the
 * header, sub-issues, and links are kept whole, the description comes next,
 * and comments fill what is left, newest first.
 */
export function renderLinearIssueMarkdown(issue: LinearIssueDetail, maxChars: number): string {
  const header = renderHeader(issue);
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
  const fixed = [header, children, links].filter((part) => part !== null);
  const separator = "\n\n";
  let budget = maxChars - fixed.join(separator).length;

  const descriptionText = issue.description?.trim() ?? "";
  const descriptionHeading = "## Description\n";
  let description: string | null = null;
  if (descriptionText.length > 0 && budget > descriptionHeading.length + separator.length) {
    description =
      descriptionHeading +
      truncate(descriptionText, budget - descriptionHeading.length - separator.length);
    budget -= description.length + separator.length;
  }

  const comments = issue.comments.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const commentsHeading = "## Comments";
  const kept: string[] = [];
  let omitted = comments.length;
  if (comments.length > 0) {
    let remaining = budget - commentsHeading.length - separator.length * 2;
    for (let index = comments.length - 1; index >= 0; index--) {
      const rendered = renderComment(comments[index]!);
      if (rendered.length + separator.length > remaining) break;
      kept.unshift(rendered);
      remaining -= rendered.length + separator.length;
      omitted--;
    }
  }
  const commentsSection =
    kept.length > 0
      ? [
          commentsHeading,
          ...(omitted > 0
            ? [`_${omitted} earlier comment${omitted === 1 ? "" : "s"} omitted._`]
            : []),
          ...kept,
        ].join(separator)
      : null;

  const sections = [header, description, children, links, commentsSection].filter(
    (part) => part !== null,
  );
  return truncate(sections.join(separator), maxChars);
}
