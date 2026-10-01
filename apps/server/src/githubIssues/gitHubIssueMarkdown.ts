import { type IssueComment, renderIssueMarkdown } from "../issueMarkdown.ts";

export interface GitHubIssueComment {
  readonly authorLogin: string | null;
  readonly authorAssociation: string;
  readonly body: string;
  readonly createdAt: string;
  readonly isMinimized: boolean;
}

export interface GitHubIssueDetail {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly state: "open" | "closed";
  readonly stateReason: string | null;
  readonly authorLogin: string | null;
  readonly assigneeLogins: ReadonlyArray<string>;
  readonly labels: ReadonlyArray<string>;
  readonly milestone: string | null;
  readonly comments: ReadonlyArray<GitHubIssueComment>;
}

const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
// "+1", "same here", and reaction-only comments say nothing an agent can act on.
const NOISE_PATTERN =
  /^(?:\+1|-1|same(?: here| issue)?|me too|bump|any updates?\??|following|subscribed?)[.!]*$/i;
const EMOJI_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Variation_Selector}|\p{Join_Control}/gu;

function isNoise(body: string): boolean {
  return NOISE_PATTERN.test(body) || body.replace(EMOJI_PATTERN, "").trim().length === 0;
}

/**
 * The comments worth an agent's context: hidden (minimized) comments and empty, "+1", or
 * reaction-only comments are dropped. Maintainers and the issue's author are marked, since their
 * comments usually carry the decisions.
 */
export function selectGitHubIssueComments(
  issue: Pick<GitHubIssueDetail, "authorLogin" | "comments">,
): IssueComment[] {
  return issue.comments
    .filter((comment) => !comment.isMinimized && !isNoise(comment.body.trim()))
    .map((comment) => {
      const login = comment.authorLogin ?? "ghost";
      const role =
        comment.authorLogin !== null && comment.authorLogin === issue.authorLogin
          ? "author"
          : MAINTAINER_ASSOCIATIONS.has(comment.authorAssociation)
            ? "maintainer"
            : null;
      return {
        author: role === null ? login : `${login} (${role})`,
        createdAt: comment.createdAt,
        body: comment.body,
      };
    });
}

function renderHeader(issue: GitHubIssueDetail): string {
  const state =
    issue.state === "open"
      ? "Open"
      : issue.stateReason
        ? `Closed (${issue.stateReason})`
        : "Closed";
  const facts = [
    `State: ${state}`,
    issue.authorLogin ? `Author: ${issue.authorLogin}` : null,
    issue.assigneeLogins.length > 0 ? `Assignees: ${issue.assigneeLogins.join(", ")}` : null,
    issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : null,
    issue.milestone ? `Milestone: ${issue.milestone}` : null,
  ].filter((fact) => fact !== null);
  return [`# ${issue.repository}#${issue.number}: ${issue.title}`, issue.url, "", ...facts].join(
    "\n",
  );
}

/** Renders an issue and its selected comments as the markdown an agent receives. */
export function renderGitHubIssueMarkdown(issue: GitHubIssueDetail, maxChars: number): string {
  return renderIssueMarkdown(
    {
      header: renderHeader(issue),
      description: issue.body,
      sections: [],
      comments: selectGitHubIssueComments(issue),
    },
    maxChars,
  );
}
