import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useAttachLinearIssue } from "./LinearIssuePicker";
import { useAttachNotionPage } from "./NotionPagePicker";
import { useAttachGoogleFile } from "./GoogleFilePicker";
import { useAttachGranolaNote } from "./GranolaNotePicker";
import { slackGetThreadInput, useAttachSlackMessage } from "./SlackMessagePicker";
import { discordGetThreadInput, useAttachDiscordMessage } from "./DiscordMessagePicker";
import { useAttachGitHubIssue } from "./GitHubIssuePicker";

export function useComposerIntegrationReferences(routeThreadRef: ScopedThreadRef) {
  const attachLinearIssue = useAttachLinearIssue();
  const attachNotionPage = useAttachNotionPage();
  const attachGoogleFile = useAttachGoogleFile();
  const attachGranolaNote = useAttachGranolaNote();
  const attachSlackMessage = useAttachSlackMessage();
  const attachDiscordMessage = useAttachDiscordMessage();
  const attachGitHubIssue = useAttachGitHubIssue();
  return (item: ComposerReferenceItem) => {
    if (item.type === "linear-issue") void attachLinearIssue(routeThreadRef, item.issueId);
    if (item.type === "github-issue") void attachGitHubIssue(routeThreadRef, item.url);
    if (item.type === "notion-page") void attachNotionPage(routeThreadRef, item.pageId);
    if (item.type === "google-file") void attachGoogleFile(routeThreadRef, item.fileId);
    if (item.type === "granola-note") void attachGranolaNote(routeThreadRef, item.noteId);
    if (item.type === "slack-message") {
      void attachSlackMessage(routeThreadRef, slackGetThreadInput(item.message, "thread"));
    }
    if (item.type === "discord-message") {
      void attachDiscordMessage(routeThreadRef, discordGetThreadInput(item.message, "thread"));
    }
  };
}
