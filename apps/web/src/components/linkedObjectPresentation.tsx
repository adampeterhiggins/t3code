import { GoogleSourceIcon } from "./Icons";
import { GoogleFileDetails } from "./GoogleFileDetails";
import type {
  DevinReviewContextRecord,
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
  SlackResourceContextRecord,
  SlackThreadContextRecord,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { FolderGit2Icon, MessageSquareTextIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { useLinearLinkClickHandler } from "~/browser/useLinearLinkClickHandler";
import { m, type MessageResolver } from "~/i18n/messages";
import {
  DevinReviewDetails,
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
  SlackResourceDetails,
  SlackThreadDetails,
} from "./integrationContextDetails";
import { GitHubRefIcon, gitHubRefKindLabel } from "./gitHubRefPresentation";
import {
  DevinIcon,
  DiscordIcon,
  GitHubIcon,
  GranolaIcon,
  LinearIcon,
  NotionIcon,
  SlackIcon,
} from "./Icons";

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
  | DevinReviewContextRecord
  | PromptLinkContextRecord
  | SlackThreadContextRecord
  | SlackResourceContextRecord
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
  "devin-review",
  "prompt-link",
  "slack-thread",
  "slack-resource",
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
    case "devin-review":
      return <DevinIcon />;
    case "prompt-link":
      return <MessageSquareTextIcon />;
    case "slack-thread":
    case "slack-resource":
      return <SlackIcon />;
    case "discord-thread":
      return <DiscordIcon />;
  }
}

const SLACK_RESOURCE_KIND_LABELS: Record<SlackResourceContextRecord["resourceType"], string> = {
  canvas: msg("Slack canvas"),
  list: msg("Slack list"),
  file: msg("Slack file"),
  user: msg("Slack profile"),
};

const GOOGLE_FILE_KIND_LABELS: Record<GoogleFileContextRecord["fileType"], string> = {
  email: msg("Gmail conversation"),
  event: msg("Google Calendar event"),
  sheet: msg("Google Sheet"),
  doc: msg("Google Doc"),
  folder: msg("Google Drive folder"),
  slides: msg("Google Slides"),
  drive: msg("Google Drive file"),
};

/** What the record is, for screen readers: "Linear issue", "Slack message", and so on. */
export function linkedObjectKindLabel(
  record: LinkedObjectContextRecord,
  resolve: MessageResolver = m,
): string {
  switch (record.kind) {
    case "linear-issue":
      return resolve(msg("Linear issue"));
    case "linear-object":
      return linearObjectKindLabel(record.objectType, resolve);
    case "github-issue":
      return resolve(msg("GitHub issue"));
    case "github-ref":
      return gitHubRefKindLabel(record.refType);
    case "repository":
      return resolve(msg("Repository"));
    case "notion-page":
      return resolve(msg("Notion page"));
    case "google-file":
      return resolve(GOOGLE_FILE_KIND_LABELS[record.fileType]);
    case "granola-note":
      return resolve(msg("Granola note"));
    case "devin-review":
      return resolve(msg("Devin Review"));
    case "prompt-link":
      return resolve(msg("T3 Code prompt link"));
    case "slack-thread":
      return record.scope === "thread"
        ? resolve(msg("Slack thread"))
        : record.scope === "channel"
          ? resolve(msg("Slack channel"))
          : resolve(msg("Slack message"));
    case "slack-resource":
      return resolve(SLACK_RESOURCE_KIND_LABELS[record.resourceType]);
    case "discord-thread":
      return record.scope === "thread"
        ? resolve(msg("Discord thread"))
        : resolve(msg("Discord message"));
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
    case "devin-review":
      return <DevinReviewDetails record={record} onOpenLink={onOpenLink} />;
    case "prompt-link":
      return <PromptLinkDetails record={record} onOpenLink={onOpenLink} />;
    case "slack-thread":
      return <SlackThreadDetails record={record} onOpenLink={onOpenLink} />;
    case "slack-resource":
      return <SlackResourceDetails record={record} onOpenLink={onOpenLink} />;
    case "discord-thread":
      return <DiscordThreadDetails record={record} onOpenLink={onOpenLink} />;
  }
}
