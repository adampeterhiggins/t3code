import { useAtomValue } from "@effect/atom-react";
import { notionLinkForThread } from "@t3tools/client-runtime/state/notion";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { slackLinkForThread } from "@t3tools/client-runtime/state/slack";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Alert, Pressable, Text } from "react-native";

import { ControlPillMenu } from "../../components/ControlPillMenu";
import { useNotionPagePicker } from "../../components/NotionPagePickerSheet";
import { useSlackMessagePicker } from "../../components/SlackMessagePickerSheet";
import { tryOpenExternalUrl, type ExternalUrlTarget } from "../../lib/openExternalUrl";
import { notionEnvironment } from "../../state/notion";
import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";

const OPEN_ACTION = "link:open";
const CHANGE_ACTION = "link:change";
const UNLINK_ACTION = "link:unlink";
export const LINK_SLACK_ACTION = "tab:link-slack";
export const LINK_NOTION_ACTION = "tab:link-notion";

/**
 * The Slack thread and Notion page linked to the thread's tab group, with their link pickers.
 * Linking needs the integration on, a server that answers with links (older servers have none),
 * and the orchestration grant; the server still authorizes every change.
 */
export function useThreadSlackNotionLinks(environmentId: EnvironmentId, threadId: ThreadId) {
  const slackLinks = useEnvironmentQuery(
    slackEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const notionLinks = useEnvironmentQuery(
    notionEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const canEditSlack = useAtomValue(slackEnvironment.linkThread.permissionAtom(environmentId));
  const canEditNotion = useAtomValue(notionEnvironment.linkThread.permissionAtom(environmentId));
  const slackPicker = useSlackMessagePicker({ mode: "link", environmentId, threadId });
  const notionPicker = useNotionPagePicker({ mode: "link", environmentId, threadId });
  const slackLink = slackLinkForThread(slackLinks, threadId);
  const notionLink = notionLinkForThread(notionLinks, threadId);
  const openSlackPicker = canEditSlack && slackLinks != null ? slackPicker.open : undefined;
  const openNotionPicker = canEditNotion && notionLinks != null ? notionPicker.open : undefined;
  return {
    environmentId,
    threadId,
    slackLink,
    notionLink,
    canEditSlack,
    canEditNotion,
    /** Opens the Slack link picker; undefined when linking is unavailable. */
    openSlackPicker,
    openNotionPicker,
    /** Tab-menu items for links the group does not have yet; the chips change existing ones. */
    menuActions: [
      ...(slackLink === null && openSlackPicker
        ? [{ id: LINK_SLACK_ACTION, title: "Link Slack thread", image: "link" }]
        : []),
      ...(notionLink === null && openNotionPicker
        ? [{ id: LINK_NOTION_ACTION, title: "Link Notion page", image: "link" }]
        : []),
    ],
    sheets: (
      <>
        {slackPicker.sheet}
        {notionPicker.sheet}
      </>
    ),
  };
}

export type ThreadSlackNotionLinks = ReturnType<typeof useThreadSlackNotionLinks>;

/** Handles a tab-menu item from `menuActions`; false when the id is not one of them. */
export function handleSlackNotionMenuAction(links: ThreadSlackNotionLinks, id: string): boolean {
  if (id === LINK_SLACK_ACTION) links.openSlackPicker?.();
  else if (id === LINK_NOTION_ACTION) links.openNotionPicker?.();
  else return false;
  return true;
}

/** The linked Slack thread and Notion page as chips to open, change, or unlink them. */
export function ThreadSlackNotionLinkChips(props: { readonly links: ThreadSlackNotionLinks }) {
  const { environmentId, threadId, slackLink, notionLink } = props.links;
  const unlinkSlack = useAtomCommand(slackEnvironment.unlinkThread, {
    label: "slack thread unlink",
    reportFailure: false,
  });
  const unlinkNotion = useAtomCommand(notionEnvironment.unlinkThread, {
    label: "notion thread unlink",
    reportFailure: false,
  });
  const unlink = async (command: typeof unlinkSlack | typeof unlinkNotion, title: string) => {
    const result = await command({ environmentId, input: { threadId } });
    if (result._tag !== "Failure") return;
    const error = squashAtomCommandFailure(result);
    Alert.alert(
      title,
      error instanceof Error && error.message.trim() ? error.message : "Try again.",
    );
  };

  return (
    <>
      {slackLink ? (
        <LinkChip
          label={slackLink.channelLabel}
          description={`Linked Slack thread in ${slackLink.channelLabel}: ${slackLink.title}`}
          url={slackLink.url}
          target="slack"
          openTitle="Open in Slack"
          changeTitle="Change Slack thread…"
          unlinkTitle="Unlink Slack thread"
          onChange={props.links.openSlackPicker}
          onUnlink={
            props.links.canEditSlack
              ? () => void unlink(unlinkSlack, "Could not unlink Slack thread")
              : undefined
          }
        />
      ) : null}
      {notionLink ? (
        <LinkChip
          label={notionLink.title}
          description={`Linked Notion page: ${notionLink.title}`}
          url={notionLink.url}
          target="notion"
          openTitle="Open in Notion"
          changeTitle="Change page…"
          unlinkTitle="Unlink page"
          onChange={props.links.openNotionPicker}
          onUnlink={
            props.links.canEditNotion
              ? () => void unlink(unlinkNotion, "Could not unlink page")
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function LinkChip(props: {
  readonly label: string;
  readonly description: string;
  readonly url: string;
  readonly target: ExternalUrlTarget;
  readonly openTitle: string;
  readonly changeTitle: string;
  readonly unlinkTitle: string;
  /** Omitted when the integration is off or the connection cannot link. */
  readonly onChange: (() => void) | undefined;
  /** Omitted when the connection cannot link; unlinking otherwise stays available as the way out. */
  readonly onUnlink: (() => void) | undefined;
}) {
  const onMenuAction = (id: string) => {
    if (id === OPEN_ACTION) {
      void tryOpenExternalUrl(props.url, props.target).then((opened) => {
        if (!opened) Alert.alert("Could not open the link", "Try again later.");
      });
    } else if (id === CHANGE_ACTION) props.onChange?.();
    else if (id === UNLINK_ACTION) props.onUnlink?.();
  };

  return (
    <ControlPillMenu
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.description}
      title={props.description}
      actions={[
        { id: OPEN_ACTION, title: props.openTitle, image: "arrow.up.right.square" },
        ...(props.onChange
          ? [{ id: CHANGE_ACTION, title: props.changeTitle, image: "pencil" }]
          : []),
        ...(props.onUnlink
          ? [
              {
                id: UNLINK_ACTION,
                title: props.unlinkTitle,
                image: "link",
                attributes: { destructive: true },
              },
            ]
          : []),
      ]}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <Pressable
        accessibilityLabel={props.description}
        accessibilityRole="button"
        className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
      >
        <Text numberOfLines={1} className="max-w-32 text-sm font-medium text-foreground">
          {props.label}
        </Text>
      </Pressable>
    </ControlPillMenu>
  );
}
