import { GoogleSourceIcon } from "./Icons";
import { GoogleFileDetails } from "./GoogleFileDetails";
import type {
  DiscordThreadContextRecord,
  GitHubIssueContextRecord,
  GitHubRefContextRecord,
  GranolaNoteContextRecord,
  LinearIssueContextRecord,
  LinearObjectContextRecord,
  NotionPageContextRecord,
  GoogleFileContextRecord,
  PromptLinkContextRecord,
  RepositoryContextRecord,
  SlackThreadContextRecord,
} from "@t3tools/contracts";
import { FolderGit2Icon, MessageSquareTextIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { useLinearLinkClickHandler } from "~/browser/useLinearLinkClickHandler";
import {
  DiscordThreadDetails,
  GitHubIssueDetails,
  GitHubRefDetails,
  GranolaNoteDetails,
  LinearIssueDetails,
  LinearObjectDetails,
  linearObjectKindLabel,
  NotionPageDetails,
  PromptLinkDetails,
  RepositoryDetails,
  SlackThreadDetails,
} from "./integrationContextDetails";
import { GitHubRefIcon, gitHubRefKindLabel } from "./gitHubRefPresentation";
import { DiscordIcon, GitHubIcon, GranolaIcon, LinearIcon, NotionIcon, SlackIcon } from "./Icons";

/**
 * Something outside the conversation that a link names, as a context record. A composer chip,
 * a sent message's chip, and a link in message text all describe it through this module, so the
 * same issue or Slack thread reads the same wherever it shows up.
 */
export type LinkedObjectContextRecord =
  | LinearIssueContextRecord
  | LinearObjectContextRecord
  | GitHubIssueContextRecord
  | GitHubRefContextRecord
  | RepositoryContextRecord
  | NotionPageContextRecord
  | GoogleFileContextRecord
  | GranolaNoteContextRecord
  | PromptLinkContextRecord
  | SlackThreadContextRecord
  | DiscordThreadContextRecord;

export type LinkedObjectContextKind = LinkedObjectContextRecord["kind"];

const LINKED_OBJECT_CONTEXT_KINDS = [
  "linear-issue",
  "linear-object",
  "github-issue",
  "github-ref",
  "repository",
  "notion-page",
  "google-file",
  "granola-note",
  "prompt-link",
  "slack-thread",
  "discord-thread",
] as const satisfies ReadonlyArray<LinkedObjectContextKind>;

const LINKED_OBJECT_KIND_SET: ReadonlySet<string> = new Set(LINKED_OBJECT_CONTEXT_KINDS);

export function isLinkedObjectContextKind(kind: string): kind is LinkedObjectContextKind {
  return LINKED_OBJECT_KIND_SET.has(kind);
}

export function isLinkedObjectContextRecord(record: {
  readonly kind: string;
}): record is LinkedObjectContextRecord {
  return isLinkedObjectContextKind(record.kind);
}

export function linkedObjectIcon(record: LinkedObjectContextRecord) {
  switch (record.kind) {
    case "linear-issue":
    case "linear-object":
      return <LinearIcon />;
    case "github-issue":
      return <GitHubIcon />;
    case "github-ref":
      return <GitHubRefIcon refType={record.refType} />;
    case "repository":
      return <FolderGit2Icon />;
    case "notion-page":
      return <NotionIcon />;
    case "google-file":
      return <GoogleSourceIcon fileType={record.fileType} />;
    case "granola-note":
      return <GranolaIcon />;
    case "prompt-link":
      return <MessageSquareTextIcon />;
    case "slack-thread":
      return <SlackIcon />;
    case "discord-thread":
      return <DiscordIcon />;
  }
}

/** What the record is, for screen readers: "Linear issue", "Slack message", and so on. */
export function linkedObjectKindLabel(record: LinkedObjectContextRecord): string {
  switch (record.kind) {
    case "linear-issue":
      return "Linear issue";
    case "linear-object":
      return linearObjectKindLabel(record.objectType);
    case "github-issue":
      return "GitHub issue";
    case "github-ref":
      return gitHubRefKindLabel(record.refType);
    case "repository":
      return "Repository";
    case "notion-page":
      return "Notion page";
    case "google-file":
      return record.fileType === "email"
        ? "Gmail conversation"
        : record.fileType === "event"
          ? "Google Calendar event"
          : record.fileType === "sheet"
            ? "Google Sheet"
            : record.fileType === "doc"
              ? "Google Doc"
              : record.fileType === "folder"
                ? "Google Drive folder"
                : record.fileType === "slides"
                  ? "Google Slides"
                  : "Google Drive file";
    case "granola-note":
      return "Granola note";
    case "prompt-link":
      return "T3 Code prompt link";
    case "slack-thread":
      return record.scope === "thread" ? "Slack thread" : "Slack message";
    case "discord-thread":
      return record.scope === "thread" ? "Discord thread" : "Discord message";
  }
}

/** The body of the hover card, with a link back to where the record came from. */
export function LinkedObjectDetails(props: {
  record: LinkedObjectContextRecord;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { record, onOpenLink } = props;
  const openLinearLink = useLinearLinkClickHandler(onOpenLink);
  switch (record.kind) {
    case "linear-issue":
      return (
        <LinearIssueDetails
          identifier={record.identifier}
          stateName={record.stateName}
          url={record.url}
          markdown={record.markdown}
          onOpenLink={openLinearLink}
        />
      );
    case "linear-object":
      return <LinearObjectDetails record={record} onOpenLink={openLinearLink} />;
    case "github-issue":
      return <GitHubIssueDetails record={record} onOpenLink={onOpenLink} />;
    case "github-ref":
      return <GitHubRefDetails record={record} onOpenLink={onOpenLink} />;
    case "repository":
      return <RepositoryDetails record={record} onOpenLink={onOpenLink} />;
    case "notion-page":
      return <NotionPageDetails record={record} onOpenLink={onOpenLink} />;
    case "google-file":
      return <GoogleFileDetails record={record} onOpenLink={onOpenLink} />;
    case "granola-note":
      return <GranolaNoteDetails record={record} onOpenLink={onOpenLink} />;
    case "prompt-link":
      return <PromptLinkDetails record={record} onOpenLink={onOpenLink} />;
    case "slack-thread":
      return <SlackThreadDetails record={record} onOpenLink={onOpenLink} />;
    case "discord-thread":
      return <DiscordThreadDetails record={record} onOpenLink={onOpenLink} />;
  }
}
