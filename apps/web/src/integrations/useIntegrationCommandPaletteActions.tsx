import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ServerSettings } from "@t3tools/contracts";
import type { Project } from "../types";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { isGitHubProject } from "@t3tools/client-runtime/state/github-issues";
import { openGitHubIssuePicker } from "../components/chat/GitHubIssuePicker";
import {
  useThreadGitHubIssueLink,
  useUnlinkGitHubIssue,
} from "../components/chat/GitHubIssueThreadLink";
import { openNotionPagePicker } from "../components/chat/NotionPagePicker";
import { openGoogleFilePicker } from "../components/chat/GoogleFilePicker";
import { openGranolaNotePicker } from "../components/chat/GranolaNotePicker";
import { openSlackMessagePicker } from "../components/chat/SlackMessagePicker";
import { openDiscordMessagePicker } from "../components/chat/DiscordMessagePicker";
import { openLinearIssuePicker } from "../components/chat/LinearIssuePicker";
import { useThreadLinearLink, useUnlinkLinearIssue } from "../components/chat/LinearThreadLink";
import { useThreadNotionLink, useUnlinkNotionPage } from "../components/chat/NotionThreadLink";
import { useThreadGoogleLink, useUnlinkGoogleFile } from "../components/chat/GoogleThreadLink";
import { useThreadGranolaLink, useUnlinkGranolaNote } from "../components/chat/GranolaThreadLink";
import { useThreadSlackLink, useUnlinkSlackThread } from "../components/chat/SlackThreadLink";
import { useThreadDiscordLink, useUnlinkDiscordThread } from "../components/chat/DiscordThreadLink";
import { githubIssueEnvironment } from "../state/githubIssues";
import { linearEnvironment } from "../state/linear";
import { notionEnvironment } from "../state/notion";
import { googleEnvironment } from "../state/google";
import { granolaEnvironment } from "../state/granola";
import { slackEnvironment } from "../state/slack";
import { discordEnvironment } from "../state/discord";
import {
  DiscordIcon,
  GitHubIcon,
  GranolaIcon,
  LinearIcon,
  NotionIcon,
  GoogleIcon,
  SlackIcon,
} from "../components/Icons";

export function useIntegrationCommandPaletteActions(
  activeLinkThreadRef: ScopedThreadRef | null,
  composerProject: Project | undefined,
  composerSettings: ServerSettings | undefined,
): CommandPaletteActionItem[] {
  const activeLinearLink = useThreadLinearLink(activeLinkThreadRef);
  const unlinkLinearIssue = useUnlinkLinearIssue();
  const canLinkLinearIssue = useAtomValue(
    linearEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const activeSlackLink = useThreadSlackLink(activeLinkThreadRef);
  const unlinkSlackThread = useUnlinkSlackThread();
  const canLinkSlack = useAtomValue(
    slackEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const activeDiscordLink = useThreadDiscordLink(activeLinkThreadRef);
  const unlinkDiscordThread = useUnlinkDiscordThread();
  const canLinkDiscord = useAtomValue(
    discordEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const activeNotionLink = useThreadNotionLink(activeLinkThreadRef);
  const activeGoogleLink = useThreadGoogleLink(activeLinkThreadRef);
  const unlinkNotionPage = useUnlinkNotionPage();
  const unlinkGoogleFile = useUnlinkGoogleFile();
  const canLinkNotion = useAtomValue(
    notionEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const canLinkGoogle = useAtomValue(
    googleEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const activeGranolaLink = useThreadGranolaLink(activeLinkThreadRef);
  const unlinkGranolaNote = useUnlinkGranolaNote();
  const canLinkGranola = useAtomValue(
    granolaEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const activeGitHubIssueLink = useThreadGitHubIssueLink(activeLinkThreadRef);
  const unlinkGitHubIssue = useUnlinkGitHubIssue();
  const canLinkGitHubIssue = useAtomValue(
    githubIssueEnvironment.linkThread.permissionAtom(activeLinkThreadRef?.environmentId ?? null),
  );
  const actionItems: CommandPaletteActionItem[] = [];
  if (activeLinkThreadRef !== null) {
    const composerThreadRef = activeLinkThreadRef;
    actionItems.push({
      kind: "action",
      value: "action:attach-linear-issue",
      searchTerms: ["linear", "issue", "ticket", "attach", "context"],
      title: "Attach Linear issue",
      icon: <LinearIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        openLinearIssuePicker(composerThreadRef);
      },
    });
    if (composerSettings?.enableNotionIntegration !== false) {
      actionItems.push({
        kind: "action",
        value: "action:attach-notion-page",
        searchTerms: ["notion", "page", "document", "attach", "context"],
        title: "Attach Notion page",
        icon: <NotionIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openNotionPagePicker(composerThreadRef);
        },
      });
    }
    if (composerSettings?.enableGoogleIntegration !== false) {
      actionItems.push({
        kind: "action",
        value: "action:attach-google-file",
        searchTerms: [
          "google",
          "gmail",
          "email",
          "calendar",
          "page",
          "document",
          "attach",
          "context",
        ],
        title: "Attach Google file, event or email",
        icon: <GoogleIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openGoogleFilePicker(composerThreadRef);
        },
      });
    }
    if (composerSettings?.enableGranolaIntegration !== false) {
      actionItems.push({
        kind: "action",
        value: "action:attach-granola-note",
        searchTerms: ["granola", "meeting", "notes", "transcript", "call", "attach", "context"],
        title: "Attach Granola note",
        icon: <GranolaIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openGranolaNotePicker(composerThreadRef);
        },
      });
    }
    if (composerSettings?.enableSlackIntegration !== false) {
      actionItems.push({
        kind: "action",
        value: "action:attach-slack-message",
        searchTerms: ["slack", "message", "thread", "conversation", "attach", "context"],
        title: "Attach Slack message",
        icon: <SlackIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openSlackMessagePicker(composerThreadRef);
        },
      });
    }
    if (composerSettings?.enableDiscordIntegration !== false) {
      actionItems.push({
        kind: "action",
        value: "action:attach-discord-message",
        searchTerms: ["discord", "message", "thread", "conversation", "attach", "context"],
        title: "Attach Discord message",
        icon: <DiscordIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openDiscordMessagePicker(composerThreadRef);
        },
      });
    }
    if (isGitHubProject(composerProject)) {
      actionItems.push({
        kind: "action",
        value: "action:attach-github-issue",
        searchTerms: ["github", "issue", "ticket", "attach", "context"],
        title: "Attach GitHub issue",
        icon: <GitHubIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openGitHubIssuePicker(composerThreadRef);
        },
      });
      if (canLinkGitHubIssue) {
        actionItems.push({
          kind: "action",
          value: "action:link-github-issue",
          searchTerms: ["github", "issue", "ticket", "link", "thread"],
          title: activeGitHubIssueLink
            ? `Change linked GitHub issue (#${activeGitHubIssueLink.number})`
            : "Link GitHub issue",
          icon: <GitHubIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            openGitHubIssuePicker(composerThreadRef, "link");
          },
        });
      }
    }
    // Unlinking needs no listing, so it stays offered even if the project stops being on GitHub.
    if (canLinkGitHubIssue && activeGitHubIssueLink) {
      actionItems.push({
        kind: "action",
        value: "action:unlink-github-issue",
        searchTerms: ["github", "issue", "ticket", "unlink", "remove"],
        title: `Unlink GitHub issue #${activeGitHubIssueLink.number}`,
        icon: <GitHubIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await unlinkGitHubIssue(composerThreadRef);
        },
      });
    }
    if (canLinkLinearIssue) {
      actionItems.push({
        kind: "action",
        value: "action:link-linear-issue",
        searchTerms: ["linear", "issue", "ticket", "link", "thread"],
        title: activeLinearLink
          ? `Change linked Linear issue (${activeLinearLink.identifier})`
          : "Link Linear issue",
        icon: <LinearIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openLinearIssuePicker(composerThreadRef, "link");
        },
      });
      if (activeLinearLink) {
        actionItems.push({
          kind: "action",
          value: "action:unlink-linear-issue",
          searchTerms: ["linear", "issue", "ticket", "unlink", "remove"],
          title: `Unlink Linear issue ${activeLinearLink.identifier}`,
          icon: <LinearIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            await unlinkLinearIssue(composerThreadRef);
          },
        });
      }
    }
    if (canLinkSlack && composerSettings?.enableSlackIntegration === true) {
      actionItems.push({
        kind: "action",
        value: "action:link-slack-thread",
        searchTerms: ["slack", "thread", "conversation", "link"],
        title: activeSlackLink
          ? `Change linked Slack thread (${activeSlackLink.channelLabel})`
          : "Link Slack thread",
        icon: <SlackIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openSlackMessagePicker(composerThreadRef, "link");
        },
      });
    }
    // Unlinking stays reachable with the integration off: it is the way out of a link.
    if (canLinkSlack && activeSlackLink) {
      actionItems.push({
        kind: "action",
        value: "action:unlink-slack-thread",
        searchTerms: ["slack", "thread", "conversation", "unlink", "remove"],
        title: `Unlink Slack thread in ${activeSlackLink.channelLabel}`,
        icon: <SlackIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await unlinkSlackThread(composerThreadRef);
        },
      });
    }
    if (canLinkDiscord && composerSettings?.enableDiscordIntegration === true) {
      actionItems.push({
        kind: "action",
        value: "action:link-discord-thread",
        searchTerms: ["discord", "thread", "conversation", "link"],
        title: activeDiscordLink
          ? `Change linked Discord thread (${activeDiscordLink.channelLabel})`
          : "Link Discord thread",
        icon: <DiscordIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openDiscordMessagePicker(composerThreadRef, "link");
        },
      });
    }
    // Unlinking stays reachable with the integration off: it is the way out of a link.
    if (canLinkDiscord && activeDiscordLink) {
      actionItems.push({
        kind: "action",
        value: "action:unlink-discord-thread",
        searchTerms: ["discord", "thread", "conversation", "unlink", "remove"],
        title: `Unlink Discord thread in ${activeDiscordLink.channelLabel}`,
        icon: <DiscordIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await unlinkDiscordThread(composerThreadRef);
        },
      });
    }
    if (canLinkNotion && composerSettings?.enableNotionIntegration === true) {
      actionItems.push({
        kind: "action",
        value: "action:link-notion-page",
        searchTerms: ["notion", "page", "document", "link"],
        title: activeNotionLink
          ? `Change linked Notion page (${activeNotionLink.title})`
          : "Link Notion page",
        icon: <NotionIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openNotionPagePicker(composerThreadRef, "link");
        },
      });
    }
    if (canLinkGoogle && composerSettings?.enableGoogleIntegration === true) {
      actionItems.push({
        kind: "action",
        value: "action:link-google-file",
        searchTerms: ["google", "gmail", "email", "calendar", "page", "document", "link"],
        title: activeGoogleLink
          ? `Change linked Google source (${activeGoogleLink.title})`
          : "Link Google file, event or email",
        icon: <GoogleIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openGoogleFilePicker(composerThreadRef, "link");
        },
      });
    }
    if (canLinkNotion && activeNotionLink) {
      actionItems.push({
        kind: "action",
        value: "action:unlink-notion-page",
        searchTerms: ["notion", "page", "document", "unlink", "remove"],
        title: `Unlink Notion page ${activeNotionLink.title}`,
        icon: <NotionIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await unlinkNotionPage(composerThreadRef);
        },
      });
    }
    if (canLinkGoogle && activeGoogleLink) {
      actionItems.push({
        kind: "action",
        value: "action:unlink-google-file",
        searchTerms: [
          "google",
          "gmail",
          "email",
          "calendar",
          "page",
          "document",
          "unlink",
          "remove",
        ],
        title: `Unlink Google source ${activeGoogleLink.title}`,
        icon: <GoogleIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await unlinkGoogleFile(composerThreadRef);
        },
      });
    }
    if (canLinkGranola && composerSettings?.enableGranolaIntegration === true) {
      actionItems.push({
        kind: "action",
        value: "action:link-granola-note",
        searchTerms: ["granola", "meeting", "notes", "link"],
        title: activeGranolaLink
          ? `Change linked Granola note (${activeGranolaLink.title})`
          : "Link Granola note",
        icon: <GranolaIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openGranolaNotePicker(composerThreadRef, "link");
        },
      });
    }
    if (canLinkGranola && activeGranolaLink) {
      actionItems.push({
        kind: "action",
        value: "action:unlink-granola-note",
        searchTerms: ["granola", "meeting", "notes", "unlink", "remove"],
        title: `Unlink Granola note ${activeGranolaLink.title}`,
        icon: <GranolaIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await unlinkGranolaNote(composerThreadRef);
        },
      });
    }
  }
  return actionItems;
}
