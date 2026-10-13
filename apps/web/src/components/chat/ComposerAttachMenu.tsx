import type { ScopedThreadRef } from "@t3tools/contracts";
import { FolderGit2Icon, LaptopIcon, MessageSquareIcon, PaperclipIcon } from "lucide-react";
import { GitHubIcon, GranolaIcon, LinearIcon, NotionIcon, SlackIcon } from "../Icons";
import { memo } from "react";
import { useEnvironmentSettings } from "~/hooks/useSettings";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useComposerMenuProps } from "./composerEventScope";
import { openGitHubIssuePicker } from "./GitHubIssuePicker";
import { openGranolaNotePicker } from "./GranolaNotePicker";
import { openLinearIssuePicker } from "./LinearIssuePicker";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { openPullRequestAttachPicker } from "./PullRequestAttachPicker";
import { openCheckoutAttachPicker } from "./CheckoutAttachPicker";
import { openRepositoryAttachPicker } from "./RepositoryAttachPicker";
import { openNotionPagePicker } from "./NotionPagePicker";
import { openSlackMessagePicker } from "./SlackMessagePicker";
import { openThreadAttachPicker } from "./ThreadAttachPicker";

/**
 * The composer's attach button: files, thread summaries, issues, Notion pages, Granola notes, Slack
 * messages, pull requests, and repositories.
 */
export const ComposerAttachMenu = memo(function ComposerAttachMenu(props: {
  threadRef: ScopedThreadRef;
  /** Whether the thread's project can list pull requests to attach. */
  pullRequestsAvailable: boolean;
  /** Whether the thread's project is a GitHub repository whose issues can be attached. */
  githubIssuesAvailable: boolean;
  /** Whether this environment has a project root or worktree to attach. */
  checkoutsAvailable: boolean;
  onAttachFiles: () => void;
}) {
  const composerMenuProps = useComposerMenuProps();
  const slackEnabled = useEnvironmentSettings(
    props.threadRef.environmentId,
    (s) => s.enableSlackIntegration,
  );
  const notionEnabled = useEnvironmentSettings(
    props.threadRef.environmentId,
    (s) => s.enableNotionIntegration,
  );
  const granolaEnabled = useEnvironmentSettings(
    props.threadRef.environmentId,
    (s) => s.enableGranolaIntegration,
  );
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
        {notionEnabled ? (
          <MenuItem onClick={() => openNotionPagePicker(props.threadRef)}>
            <NotionIcon />
            Notion page
          </MenuItem>
        ) : null}
        {granolaEnabled ? (
          <MenuItem onClick={() => openGranolaNotePicker(props.threadRef)}>
            <GranolaIcon />
            Granola note
          </MenuItem>
        ) : null}
        {slackEnabled ? (
          <MenuItem onClick={() => openSlackMessagePicker(props.threadRef)}>
            <SlackIcon />
            Slack message
          </MenuItem>
        ) : null}
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
        {props.checkoutsAvailable ? (
          <MenuItem onClick={() => openCheckoutAttachPicker(props.threadRef)}>
            <LaptopIcon />
            Checkout
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
