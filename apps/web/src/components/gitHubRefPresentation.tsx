import { parseGitHubRefUrl, type GitHubRefType } from "@t3tools/contracts";
import { GitBranchIcon, GitCommitHorizontalIcon, TagIcon } from "lucide-react";

const GITHUB_REF_TYPE_LABELS: Record<GitHubRefType, string> = {
  release: "Release",
  tag: "Tag",
  branch: "Branch",
  commit: "Commit",
};

export function gitHubRefTypeLabel(refType: GitHubRefType): string {
  return GITHUB_REF_TYPE_LABELS[refType];
}

/** "GitHub release", "GitHub branch", and so on, for a ref chip's accessible name. */
export function gitHubRefKindLabel(refType: GitHubRefType): string {
  return `GitHub ${GITHUB_REF_TYPE_LABELS[refType].toLowerCase()}`;
}

/** GitHub's own glyphs: a release is drawn as the tag it publishes. */
export function GitHubRefIcon({
  refType,
  className,
}: {
  refType: GitHubRefType;
  className?: string;
}) {
  switch (refType) {
    case "release":
    case "tag":
      return <TagIcon className={className} />;
    case "branch":
      return <GitBranchIcon className={className} />;
    case "commit":
      return <GitCommitHorizontalIcon className={className} />;
  }
}

/**
 * The ref kind a link's URL alone shows, for its icon before anything is read. A `tree` link is
 * usually a branch; one whose ref has a slash may be a folder, so it gets no ref icon.
 */
export function gitHubRefTypeFromUrl(url: string): GitHubRefType | null {
  const link = parseGitHubRefUrl(url);
  if (link === null) return null;
  if (link.linkType === "tree") return link.ref.includes("/") ? null : "branch";
  return link.linkType;
}
