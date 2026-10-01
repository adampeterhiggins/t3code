export interface IssueComment {
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
}

const TRUNCATION_MARKER = "\n\n…[truncated]";
const SEPARATOR = "\n\n";

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= TRUNCATION_MARKER.length) return "";
  return text.slice(0, maxChars - TRUNCATION_MARKER.length).trimEnd() + TRUNCATION_MARKER;
}

function renderComment(comment: IssueComment): string {
  return `**${comment.author}** (${comment.createdAt.slice(0, 10)}):\n${comment.body.trim()}`;
}

/**
 * Renders a Linear or GitHub issue as the markdown an agent receives. Within `maxChars`, the
 * header and `sections` (sub-issues, links) are kept whole, the description comes next, and
 * comments fill what is left, newest first, shown in chronological order.
 */
export function renderIssueMarkdown(
  issue: {
    readonly header: string;
    readonly description: string | null;
    readonly sections: ReadonlyArray<string>;
    readonly comments: ReadonlyArray<IssueComment>;
  },
  maxChars: number,
): string {
  let budget = maxChars - [issue.header, ...issue.sections].join(SEPARATOR).length;

  const descriptionText = issue.description?.trim() ?? "";
  const descriptionHeading = "## Description\n";
  let description: string | null = null;
  if (descriptionText.length > 0 && budget > descriptionHeading.length + SEPARATOR.length) {
    description =
      descriptionHeading +
      truncate(descriptionText, budget - descriptionHeading.length - SEPARATOR.length);
    budget -= description.length + SEPARATOR.length;
  }

  const comments = issue.comments.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const commentsHeading = "## Comments";
  const kept: string[] = [];
  let omitted = comments.length;
  if (comments.length > 0) {
    let remaining = budget - commentsHeading.length - SEPARATOR.length * 2;
    for (let index = comments.length - 1; index >= 0; index--) {
      const rendered = renderComment(comments[index]!);
      if (rendered.length + SEPARATOR.length > remaining) break;
      kept.unshift(rendered);
      remaining -= rendered.length + SEPARATOR.length;
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
        ].join(SEPARATOR)
      : null;

  const parts = [issue.header, description, ...issue.sections, commentsSection].filter(
    (part) => part !== null,
  );
  return truncate(parts.join(SEPARATOR), maxChars);
}
