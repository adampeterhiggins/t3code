import type { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { repositoryContextRecord } from "@t3tools/client-runtime/context-repositories";
import {
  gitHubIssueContextRecord,
  gitHubRefContextRecord,
} from "@t3tools/client-runtime/state/github-issues";
import { granolaNoteContextRecord } from "@t3tools/client-runtime/state/granola";
import { notionPageContextRecord } from "@t3tools/client-runtime/state/notion";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ComposerObjectLink } from "@t3tools/shared/composerObjectLinks";
import {
  discordThreadContextRecord,
  linearIssueContextRecord,
  promptLinkContextRecord,
  slackThreadContextRecord,
} from "@t3tools/shared/integrationContextRecords";
import { useRef, useState, type ReactElement } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { discordEnvironment } from "~/state/discord";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { granolaEnvironment } from "~/state/granola";
import { linearEnvironment } from "~/state/linear";
import { notionEnvironment } from "~/state/notion";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";

import { ContextPreviewBody } from "../contextPresentationRegistry";
import type { LinkedObjectContextRecord } from "../linkedObjectPresentation";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useCursorAnchor } from "./CursorPreviewCard";

/** Links that open their own previews (pull requests) or carry nothing to read are not cards. */
export type PreviewableObjectLink = Exclude<ComposerObjectLink, { kind: "pull-request" }>;

export function isPreviewableObjectLink(
  link: ComposerObjectLink | null,
): link is PreviewableObjectLink {
  return link !== null && link.kind !== "pull-request";
}

/**
 * Reads what a link names into the record a pasted copy of it would have become, so the hover
 * card is the chip's card. `available` is false when nothing will be read: its integration is
 * turned off.
 */
export function useLinkedObjectRecord(
  environmentId: EnvironmentId,
  link: PreviewableObjectLink,
  open: boolean,
) {
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const discordEnabled = useEnvironmentSettings(environmentId, (s) => s.enableDiscordIntegration);
  const notionEnabled = useEnvironmentSettings(environmentId, (s) => s.enableNotionIntegration);
  const granolaEnabled = useEnvironmentSettings(environmentId, (s) => s.enableGranolaIntegration);
  const linear = useEnvironmentQuery(
    open && link.kind === "linear-issue"
      ? linearEnvironment.issue({ environmentId, input: { id: link.identifier } })
      : null,
  );
  const gitHubIssue = useEnvironmentQuery(
    open && link.kind === "github-issue"
      ? githubIssueEnvironment.issue({ environmentId, input: { url: link.url } })
      : null,
  );
  const gitHubRef = useEnvironmentQuery(
    open && link.kind === "github-ref"
      ? githubIssueEnvironment.ref({ environmentId, input: { url: link.url } })
      : null,
  );
  const notion = useEnvironmentQuery(
    open && notionEnabled && link.kind === "notion-page"
      ? notionEnvironment.page({ environmentId, input: { id: link.pageId } })
      : null,
  );
  const granola = useEnvironmentQuery(
    open && granolaEnabled && link.kind === "granola-note"
      ? granolaEnvironment.note({ environmentId, input: { id: link.noteId } })
      : null,
  );
  const slack = useEnvironmentQuery(
    open && slackEnabled && link.kind === "slack-message"
      ? slackEnvironment.thread({
          environmentId,
          input: {
            channelId: link.channelId,
            ts: link.ts,
            ...(link.threadTs === null ? {} : { threadTs: link.threadTs }),
            url: link.url,
            scope: "thread",
          },
        })
      : null,
  );
  const discord = useEnvironmentQuery(
    open && discordEnabled && link.kind === "discord-message"
      ? discordEnvironment.thread({
          environmentId,
          input: {
            guildId: link.guildId,
            channelId: link.channelId,
            messageId: link.messageId,
            url: link.url,
            scope: "thread",
          },
        })
      : null,
  );

  const read = (): {
    available: boolean;
    record: LinkedObjectContextRecord | null;
    failed: boolean;
  } => {
    switch (link.kind) {
      case "repository":
        return { available: true, record: repositoryContextRecord(link), failed: false };
      case "prompt-link":
        return { available: true, record: promptLinkContextRecord(link), failed: false };
      case "linear-issue":
        return {
          available: true,
          record: linear.data && linearIssueContextRecord(linear.data),
          failed: linear.error !== null,
        };
      case "github-issue":
        return {
          available: true,
          record: gitHubIssue.data && gitHubIssueContextRecord(gitHubIssue.data),
          failed: gitHubIssue.error !== null,
        };
      case "github-ref":
        return {
          available: true,
          record: gitHubRef.data && gitHubRefContextRecord(gitHubRef.data),
          failed: gitHubRef.error !== null,
        };
      case "notion-page":
        return {
          available: notionEnabled,
          record: notion.data && notionPageContextRecord(notion.data),
          failed: notion.error !== null,
        };
      case "granola-note":
        return {
          available: granolaEnabled,
          record: granola.data && granolaNoteContextRecord(granola.data),
          failed: granola.error !== null,
        };
      case "slack-message":
        return {
          available: slackEnabled,
          record: slack.data && slackThreadContextRecord(slack.data),
          failed: slack.error !== null,
        };
      case "discord-message":
        return {
          available: discordEnabled,
          record: discord.data && discordThreadContextRecord(discord.data),
          failed: discord.error !== null,
        };
    }
  };
  return read();
}

/**
 * A link in message text to something a chip could hold: an issue, a Slack or Discord message, a
 * Notion page, a Granola note, a GitHub release or commit, a repository, or a prompt link.
 * Hovering it reads the object once and shows the card its chip would show. A link that can't be
 * read, or whose integration is off, shows its URL instead.
 */
export function LinkedObjectLinkPreview(props: {
  link: ReactElement;
  objectLink: PreviewableObjectLink;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
}) {
  const [open, setOpen] = useState(false);
  const cursorAnchor = useCursorAnchor();
  const previewActionsRef = useRef<PreviewCardPrimitive.Root.Actions | null>(null);
  const openLink = useLinkClickHandler(props.threadRef);
  const { available, record, failed } = useLinkedObjectRecord(
    props.environmentId,
    props.objectLink,
    open,
  );
  const url = props.objectLink.url;

  if (!available) {
    return (
      <Tooltip>
        <TooltipTrigger render={props.link} />
        <TooltipPopup side="top">{url}</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <PreviewCard
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) cursorAnchor.pin();
        setOpen(nextOpen);
      }}
      actionsRef={previewActionsRef}
    >
      <Tooltip
        open={open && failed}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && record === null) previewActionsRef.current?.close();
        }}
      >
        <PreviewCardTrigger
          render={<TooltipTrigger render={props.link} />}
          delay={350}
          closeDelay={120}
          {...cursorAnchor.triggerProps}
        />
        <TooltipPopup side="top">{url}</TooltipPopup>
      </Tooltip>
      {record === null ? null : (
        <PreviewCardPopup {...cursorAnchor.popupProps} className="w-96 max-w-[calc(100vw-2rem)]">
          <div className="px-3 py-2">
            {/* The chip's own preview, so the link reads exactly as its chip would. */}
            <ContextPreviewBody kind={record.kind} preview={{ record, onOpenLink: openLink }} />
          </div>
        </PreviewCardPopup>
      )}
    </PreviewCard>
  );
}
