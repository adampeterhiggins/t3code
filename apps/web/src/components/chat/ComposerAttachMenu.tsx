import {
  ComposerIntegrationAttachMenuItems,
  type ComposerIntegrationPicker,
  isComposerIntegrationPicker,
  openComposerIntegrationPicker,
} from "./composerIntegrationPickers";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  CpuIcon,
  FolderGit2Icon,
  LaptopIcon,
  MessageSquareIcon,
  PaperclipIcon,
} from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useComposerMenuProps } from "./composerEventScope";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { openPullRequestAttachPicker } from "./PullRequestAttachPicker";
import { openCheckoutAttachPicker } from "./CheckoutAttachPicker";
import { openRepositoryAttachPicker } from "./RepositoryAttachPicker";
import { openThreadAttachPicker } from "./ThreadAttachPicker";

/** Every attach source other than files, each opened as a picker against a thread's draft. */
export type ComposerAttachPicker =
  | ComposerIntegrationPicker
  | "thread"
  | "pull-request"
  | "checkout"
  | "repository";

export function openComposerAttachPicker(
  picker: ComposerAttachPicker,
  threadRef: ScopedThreadRef,
): void {
  if (isComposerIntegrationPicker(picker)) return openComposerIntegrationPicker(picker, threadRef);
  switch (picker) {
    case "thread":
      return openThreadAttachPicker(threadRef);
    case "pull-request":
      return openPullRequestAttachPicker(threadRef);
    case "checkout":
      return openCheckoutAttachPicker(threadRef);
    case "repository":
      return openRepositoryAttachPicker(threadRef);
  }
}

/**
 * The composer's attach button: files, thread summaries, issues, Notion pages, Granola notes, Slack
 * and Discord messages, pull requests, repositories, and models.
 */
export const ComposerAttachMenu = memo(function ComposerAttachMenu(props: {
  environmentId: EnvironmentId;
  /** Whether the thread's project can list pull requests to attach. */
  pullRequestsAvailable: boolean;
  /** Whether the thread's project is a GitHub repository whose issues can be attached. */
  githubIssuesAvailable: boolean;
  /** Whether this environment has a project root or worktree to attach. */
  checkoutsAvailable: boolean;
  onAttachFiles: () => void;
  onPick: (picker: ComposerAttachPicker) => void;
  /** Fork: opens the model picker to insert a model chip; absent where chips can't be edited. */
  onPickModel?: (() => void) | undefined;
}) {
  const composerMenuProps = useComposerMenuProps();
  return (
    <Menu>
      <MenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Attach" />}
      >
        {/* The clip's weight sits in its upper loop; 1px down reads as centered on the row. */}
        <PaperclipIcon className="translate-y-px" />
      </MenuTrigger>
      <MenuPopup side="top" align="end" {...composerMenuProps}>
        <MenuItem onClick={props.onAttachFiles}>
          <PaperclipIcon />
          Files and images
        </MenuItem>
        <MenuItem onClick={() => props.onPick("thread")}>
          <MessageSquareIcon />
          Thread
        </MenuItem>
        <ComposerIntegrationAttachMenuItems
          environmentId={props.environmentId}
          githubIssuesAvailable={props.githubIssuesAvailable}
          onPick={props.onPick}
        />
        {props.pullRequestsAvailable ? (
          <MenuItem onClick={() => props.onPick("pull-request")}>
            <PullRequestGlyph.pullRequest />
            Pull request
          </MenuItem>
        ) : null}
        {props.checkoutsAvailable ? (
          <MenuItem onClick={() => props.onPick("checkout")}>
            <LaptopIcon />
            Checkout
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => props.onPick("repository")}>
          <FolderGit2Icon />
          Repository
        </MenuItem>
        {props.onPickModel ? (
          <MenuItem onClick={props.onPickModel}>
            <CpuIcon />
            Model
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
