import {
  GitHubIcon,
  GranolaIcon,
  DiscordIcon,
  LinearIcon,
  NotionIcon,
  GoogleIcon,
  SlackIcon,
} from "../Icons";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { MenuItem } from "../ui/menu";
import { openLinearIssuePicker } from "./LinearIssuePicker";
import { openNotionPagePicker } from "./NotionPagePicker";
import { openGoogleFilePicker } from "./GoogleFilePicker";
import { openGranolaNotePicker } from "./GranolaNotePicker";
import { openSlackMessagePicker } from "./SlackMessagePicker";
import { openDiscordMessagePicker } from "./DiscordMessagePicker";
import { openGitHubIssuePicker } from "./GitHubIssuePicker";

export type ComposerIntegrationPicker =
  | "linear-issue"
  | "notion-page"
  | "google-file"
  | "granola-note"
  | "slack-message"
  | "discord-message"
  | "github-issue";

const integrationPickers = {
  "linear-issue": openLinearIssuePicker,
  "notion-page": openNotionPagePicker,
  "google-file": openGoogleFilePicker,
  "granola-note": openGranolaNotePicker,
  "slack-message": openSlackMessagePicker,
  "discord-message": openDiscordMessagePicker,
  "github-issue": openGitHubIssuePicker,
};

export function isComposerIntegrationPicker(picker: string): picker is ComposerIntegrationPicker {
  return Object.hasOwn(integrationPickers, picker);
}

export function openComposerIntegrationPicker(
  picker: ComposerIntegrationPicker,
  threadRef: ScopedThreadRef,
) {
  integrationPickers[picker](threadRef);
}

export function ComposerIntegrationAttachMenuItems(props: {
  environmentId: EnvironmentId;
  githubIssuesAvailable: boolean;
  onPick: (picker: ComposerIntegrationPicker) => void;
}) {
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
    <>
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
    </>
  );
}
