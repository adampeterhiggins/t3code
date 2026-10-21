import {
  GITHUB_ISSUE_REFERENCE,
  githubIssueReferenceUrl,
} from "@t3tools/shared/githubIssueReferences";

import { findAndReplaceText, type MarkdownNode } from "~/vendor/mdast-find-and-replace";

const IGNORED_TYPES = new Set(["link", "linkReference"]);

/**
 * Fork: links `owner/repo#123`, and `#123` when given the thread's GitHub repository, so they
 * render the way a pasted issue or pull request link does. Code and existing links keep their
 * text.
 */
export function remarkGitHubIssueReferences(repositoryUrl: string | null) {
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      GITHUB_ISSUE_REFERENCE,
      (reference) => {
        const [qualifier = "", number = ""] = reference.split("#");
        const url = githubIssueReferenceUrl(qualifier || undefined, number, repositoryUrl);
        return url === null
          ? false
          : { type: "link", url, children: [{ type: "text", value: reference }] };
      },
      IGNORED_TYPES,
    );
  };
}
