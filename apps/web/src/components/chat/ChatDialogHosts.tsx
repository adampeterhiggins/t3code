import { ConfirmDialogHost } from "../ConfirmDialogHost";
import { DiscordMessagePickerHost } from "./DiscordMessagePicker";
import { GitHubIssuePickerHost } from "./GitHubIssuePicker";
import { GranolaNotePickerHost } from "./GranolaNotePicker";
import { NotionPagePickerHost } from "./NotionPagePicker";
import { SlackMessagePickerHost } from "./SlackMessagePicker";

/**
 * Composer dialogs the thread menu and palette open from any route. ChatView owns
 * Linear and the other attach hosts, which follow the mounted thread.
 */
export function ChatDialogHosts() {
  return (
    <>
      <ConfirmDialogHost />
      <GitHubIssuePickerHost />
      <SlackMessagePickerHost />
      <DiscordMessagePickerHost />
      <NotionPagePickerHost />
      <GranolaNotePickerHost />
    </>
  );
}
