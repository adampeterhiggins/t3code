import { useAtomValue } from "@effect/atom-react";
import { isGitHubProject } from "@t3tools/client-runtime/state/github-issues";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useProject } from "~/state/entities";
import { discordEnvironment } from "~/state/discord";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { granolaEnvironment } from "~/state/granola";
import { linearEnvironment } from "~/state/linear";
import { notionEnvironment } from "~/state/notion";
import { slackEnvironment } from "~/state/slack";
import { DiscordIcon, GitHubIcon, GranolaIcon, LinearIcon, NotionIcon, SlackIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { openDiscordMessagePicker } from "./DiscordMessagePicker";
import { DiscordThreadLinkRow, useThreadDiscordLink } from "./DiscordThreadLink";
import { openGitHubIssuePicker } from "./GitHubIssuePicker";
import { GitHubIssueThreadLinkRow, useThreadGitHubIssueLink } from "./GitHubIssueThreadLink";
import { openGranolaNotePicker } from "./GranolaNotePicker";
import { GranolaThreadLinkRow, useThreadGranolaLink } from "./GranolaThreadLink";
import { openLinearIssuePicker } from "./LinearIssuePicker";
import { LinearThreadLinkRow, useThreadLinearLink } from "./LinearThreadLink";
import { openNotionPagePicker } from "./NotionPagePicker";
import { NotionThreadLinkRow, useThreadNotionLink } from "./NotionThreadLink";
import { openSlackMessagePicker } from "./SlackMessagePicker";
import { SlackThreadLinkRow, useThreadSlackLink } from "./SlackThreadLink";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** The issues, conversations, pages, and notes linked to the thread's tab group. */
export function ThreadLinks(props: { threadRef: ScopedThreadRef; projectId: ProjectId }) {
  const { threadRef } = props;
  const { environmentId } = threadRef;
  const linear = useThreadLinearLink(threadRef);
  const github = useThreadGitHubIssueLink(threadRef);
  const slack = useThreadSlackLink(threadRef);
  const discord = useThreadDiscordLink(threadRef);
  const notion = useThreadNotionLink(threadRef);
  const granola = useThreadGranolaLink(threadRef);
  const project = useProject({ environmentId, projectId: props.projectId });
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const discordEnabled = useEnvironmentSettings(environmentId, (s) => s.enableDiscordIntegration);
  const notionEnabled = useEnvironmentSettings(environmentId, (s) => s.enableNotionIntegration);
  const granolaEnabled = useEnvironmentSettings(environmentId, (s) => s.enableGranolaIntegration);
  const canLinkLinear = useAtomValue(linearEnvironment.linkThread.permissionAtom(environmentId));
  const canLinkGitHub = useAtomValue(
    githubIssueEnvironment.linkThread.permissionAtom(environmentId),
  );
  const canLinkSlack = useAtomValue(slackEnvironment.linkThread.permissionAtom(environmentId));
  const canLinkDiscord = useAtomValue(discordEnvironment.linkThread.permissionAtom(environmentId));
  const canLinkNotion = useAtomValue(notionEnvironment.linkThread.permissionAtom(environmentId));
  const canLinkGranola = useAtomValue(granolaEnvironment.linkThread.permissionAtom(environmentId));

  // A group holds one link of each kind, so only kinds without one are offered; a linked row's
  // own menu changes it. GitHub issues are listed from the project's repository.
  const addOptions: Array<{ key: string; icon: ReactNode; label: string; open: () => void }> = [];
  if (!linear && canLinkLinear) {
    addOptions.push({
      key: "linear",
      icon: <LinearIcon />,
      label: "Linear issue…",
      open: () => openLinearIssuePicker(threadRef, "link"),
    });
  }
  if (!github && canLinkGitHub && isGitHubProject(project)) {
    addOptions.push({
      key: "github",
      icon: <GitHubIcon />,
      label: "GitHub issue…",
      open: () => openGitHubIssuePicker(threadRef, "link"),
    });
  }
  if (!slack && canLinkSlack && slackEnabled) {
    addOptions.push({
      key: "slack",
      icon: <SlackIcon />,
      label: "Slack thread…",
      open: () => openSlackMessagePicker(threadRef, "link"),
    });
  }
  if (!discord && canLinkDiscord && discordEnabled) {
    addOptions.push({
      key: "discord",
      icon: <DiscordIcon />,
      label: "Discord thread…",
      open: () => openDiscordMessagePicker(threadRef, "link"),
    });
  }
  if (!notion && canLinkNotion && notionEnabled) {
    addOptions.push({
      key: "notion",
      icon: <NotionIcon />,
      label: "Notion page…",
      open: () => openNotionPagePicker(threadRef, "link"),
    });
  }
  if (!granola && canLinkGranola && granolaEnabled) {
    addOptions.push({
      key: "granola",
      icon: <GranolaIcon />,
      label: "Granola note…",
      open: () => openGranolaNotePicker(threadRef, "link"),
    });
  }

  const hasLinks = Boolean(linear || github || slack || discord || notion || granola);
  if (!hasLinks && addOptions.length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-links-heading"
      title="Links"
      actions={
        addOptions.length > 0 ? (
          <Menu>
            <MenuTrigger
              render={
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Add a link" />
              }
            >
              <PlusIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {addOptions.map((option) => (
                <MenuItem key={option.key} onClick={option.open}>
                  {option.icon}
                  {option.label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      {hasLinks ? (
        <ul className="flex flex-col">
          {linear ? <LinearThreadLinkRow threadRef={threadRef} link={linear} /> : null}
          {github ? <GitHubIssueThreadLinkRow threadRef={threadRef} link={github} /> : null}
          {slack ? <SlackThreadLinkRow threadRef={threadRef} link={slack} /> : null}
          {discord ? <DiscordThreadLinkRow threadRef={threadRef} link={discord} /> : null}
          {notion ? <NotionThreadLinkRow threadRef={threadRef} link={notion} /> : null}
          {granola ? <GranolaThreadLinkRow threadRef={threadRef} link={granola} /> : null}
        </ul>
      ) : null}
    </ThreadDetailsSection>
  );
}
