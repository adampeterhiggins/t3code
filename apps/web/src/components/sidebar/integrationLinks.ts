import type { ScopedThreadRef } from "@t3tools/contracts";
import { openLinearIssuePicker } from "../chat/LinearIssuePicker";
import { openSlackMessagePicker } from "../chat/SlackMessagePicker";
import { openDiscordMessagePicker } from "../chat/DiscordMessagePicker";
import { openNotionPagePicker } from "../chat/NotionPagePicker";
import { openGoogleFilePicker } from "../chat/GoogleFilePicker";
import { openGranolaNotePicker } from "../chat/GranolaNotePicker";
import { openGitHubIssuePicker } from "../chat/GitHubIssuePicker";

export function openSidebarIntegrationLink(action: string, threadRef: ScopedThreadRef): boolean {
  switch (action) {
    case "link-linear-issue":
      openLinearIssuePicker(threadRef, "link");
      return true;
    case "link-slack-thread":
      openSlackMessagePicker(threadRef, "link");
      return true;
    case "link-discord-thread":
      openDiscordMessagePicker(threadRef, "link");
      return true;
    case "link-notion-page":
      openNotionPagePicker(threadRef, "link");
      return true;
    case "link-google-file":
      openGoogleFilePicker(threadRef, "link");
      return true;
    case "link-granola-note":
      openGranolaNotePicker(threadRef, "link");
      return true;
    case "link-github-issue":
      openGitHubIssuePicker(threadRef, "link");
      return true;

    default:
      return false;
  }
}
