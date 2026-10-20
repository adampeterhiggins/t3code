import type { GitHubRefType } from "@t3tools/contracts";
import { GitBranchIcon, GitCommitHorizontalIcon, PackageIcon, TagIcon } from "lucide-react";

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

export function GitHubRefIcon({ refType }: { refType: GitHubRefType }) {
  switch (refType) {
    case "release":
      return <PackageIcon />;
    case "tag":
      return <TagIcon />;
    case "branch":
      return <GitBranchIcon />;
    case "commit":
      return <GitCommitHorizontalIcon />;
  }
}
