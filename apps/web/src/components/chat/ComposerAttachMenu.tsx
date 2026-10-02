import type { ScopedThreadRef } from "@t3tools/contracts";
import { FolderGit2Icon, MessageSquareIcon, PaperclipIcon } from "lucide-react";
import { GitHubIcon, LinearIcon, SlackIcon } from "../Icons";
import { memo } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useComposerMenuProps } from "./composerEventScope";
import { openGitHubIssuePicker } from "./GitHubIssuePicker";
import { openLinearIssuePicker } from "./LinearIssuePicker";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { openPullRequestAttachPicker } from "./PullRequestAttachPicker";
import { openRepositoryAttachPicker } from "./RepositoryAttachPicker";
import { openNotionPagePicker } from "./NotionPagePicker";
import { FileTextIcon } from "lucide-react";
import { openSlackMessagePicker } from "./SlackMessagePicker";
import { openThreadAttachPicker } from "./ThreadAttachPicker";

/**
 * The composer's attach button: files, thread summaries, issues, Slack messages, pull requests,
 * and repositories.
 */
export const ComposerAttachMenu = memo(function ComposerAttachMenu(props: {
  threadRef: ScopedThreadRef;
  /** Whether the thread's project can list pull requests to attach. */
  pullRequestsAvailable: boolean;
  /** Whether the thread's project is a GitHub repository whose issues can be attached. */
  githubIssuesAvailable: boolean;
  onAttachFiles: () => void;
}) {
  const composerMenuProps = useComposerMenuProps();
  return (
    <Menu>
      <MenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Attach" />}
      >
        <PaperclipIcon />
      </MenuTrigger>
      <MenuPopup side="top" align="end" {...composerMenuProps}>
        <MenuItem onClick={props.onAttachFiles}>
          <PaperclipIcon />
          Files and images
        </MenuItem>
        <MenuItem onClick={() => openThreadAttachPicker(props.threadRef)}>
          <MessageSquareIcon />
          Thread
        </MenuItem>
        <MenuItem onClick={() => openLinearIssuePicker(props.threadRef)}>
          <LinearIcon />
          Linear issue
        </MenuItem>
        <MenuItem onClick={() => openNotionPagePicker(props.threadRef)}>
          <FileTextIcon />
          Notion page
        </MenuItem>
        <MenuItem onClick={() => openSlackMessagePicker(props.threadRef)}>
          <SlackIcon />
          Slack message
        </MenuItem>
        {props.githubIssuesAvailable ? (
          <MenuItem onClick={() => openGitHubIssuePicker(props.threadRef)}>
            <GitHubIcon />
            GitHub issue
          </MenuItem>
        ) : null}
        {props.pullRequestsAvailable ? (
          <MenuItem onClick={() => openPullRequestAttachPicker(props.threadRef)}>
            <PullRequestGlyph.pullRequest />
            Pull request
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => openRepositoryAttachPicker(props.threadRef)}>
          <FolderGit2Icon />
          Repository
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
