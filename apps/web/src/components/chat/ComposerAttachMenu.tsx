import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  CpuIcon,
  FolderGit2Icon,
  LaptopIcon,
  MessageSquareIcon,
  PaperclipIcon,
} from "lucide-react";
import {
  GitHubIcon,
  GranolaIcon,
  DiscordIcon,
  LinearIcon,
  NotionIcon,
  GoogleIcon,
  SlackIcon,
} from "../Icons";
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
import { openGoogleFilePicker } from "./GoogleFilePicker";
import { openDiscordMessagePicker } from "./DiscordMessagePicker";
import { openSlackMessagePicker } from "./SlackMessagePicker";
import { openThreadAttachPicker } from "./ThreadAttachPicker";

/** Every attach source other than files, each opened as a picker against a thread's draft. */
export type ComposerAttachPicker =
  | "thread"
  | "linear-issue"
  | "notion-page"
  | "google-file"
  | "granola-note"
  | "slack-message"
  | "discord-message"
  | "github-issue"
  | "pull-request"
  | "checkout"
  | "repository";

export function openComposerAttachPicker(
  picker: ComposerAttachPicker,
  threadRef: ScopedThreadRef,
): void {
  switch (picker) {
    case "thread":
      return openThreadAttachPicker(threadRef);
    case "linear-issue":
      return openLinearIssuePicker(threadRef);
    case "notion-page":
      return openNotionPagePicker(threadRef);
    case "google-file":
      return openGoogleFilePicker(threadRef);
    case "granola-note":
      return openGranolaNotePicker(threadRef);
    case "slack-message":
      return openSlackMessagePicker(threadRef);
    case "discord-message":
      return openDiscordMessagePicker(threadRef);
    case "github-issue":
      return openGitHubIssuePicker(threadRef);
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
  const slackEnabled = useEnvironmentSettings(props.environmentId, (s) => s.enableSlackIntegration);
  const discordEnabled = useEnvironmentSettings(
    props.environmentId,
    (s) => s.enableDiscordIntegration,
  );
  const notionEnabled = useEnvironmentSettings(
    props.environmentId,
    (s) => s.enableNotionIntegration,
  );
  const googleEnabled = useEnvironmentSettings(
    props.environmentId,
    (s) => s.enableGoogleIntegration,
  );
  const granolaEnabled = useEnvironmentSettings(
    props.environmentId,
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
        <MenuItem onClick={() => props.onPick("thread")}>
          <MessageSquareIcon />
          Thread
        </MenuItem>
        <MenuItem onClick={() => props.onPick("linear-issue")}>
          <LinearIcon />
          Linear issue
        </MenuItem>
        {notionEnabled ? (
          <MenuItem onClick={() => props.onPick("notion-page")}>
            <NotionIcon />
            Notion page
          </MenuItem>
        ) : null}
        {googleEnabled ? (
          <MenuItem onClick={() => props.onPick("google-file")}>
            <GoogleIcon />
            Google
          </MenuItem>
        ) : null}
        {granolaEnabled ? (
          <MenuItem onClick={() => props.onPick("granola-note")}>
            <GranolaIcon />
            Granola note
          </MenuItem>
        ) : null}
        {slackEnabled ? (
          <MenuItem onClick={() => props.onPick("slack-message")}>
            <SlackIcon />
            Slack message
          </MenuItem>
        ) : null}
        {discordEnabled ? (
          <MenuItem onClick={() => props.onPick("discord-message")}>
            <DiscordIcon />
            Discord message
          </MenuItem>
        ) : null}
        {props.githubIssuesAvailable ? (
          <MenuItem onClick={() => props.onPick("github-issue")}>
            <GitHubIcon />
            GitHub issue
          </MenuItem>
        ) : null}
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
