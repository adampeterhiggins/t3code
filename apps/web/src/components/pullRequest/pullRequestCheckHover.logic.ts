import type { PullRequestCheck } from "@t3tools/contracts";

export function pullRequestCheckHoverDetail(
  check: Pick<PullRequestCheck, "name" | "description">,
): string | null {
  const description = check.description?.trim() ?? "";
  return description.length > 0 && description !== check.name ? description : null;
}
