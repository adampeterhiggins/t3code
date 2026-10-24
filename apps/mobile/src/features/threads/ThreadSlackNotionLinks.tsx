import { useAtomValue } from "@effect/atom-react";
import { discordLinkForThread } from "@t3tools/client-runtime/state/discord";
import { granolaLinkForThread } from "@t3tools/client-runtime/state/granola";
import { notionLinkForThread } from "@t3tools/client-runtime/state/notion";
import { googleLinkForThread } from "@t3tools/client-runtime/state/google";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { slackLinkForThread } from "@t3tools/client-runtime/state/slack";
import type { EnvironmentId, ThreadId, ThreadLinkKind } from "@t3tools/contracts";
import { Alert, Pressable, Text } from "react-native";

import { Menu } from "../../components/ui/Menu";
import { useDiscordMessagePicker } from "../../components/DiscordMessagePickerSheet";
import { useGranolaNotePicker } from "../../components/GranolaNotePickerSheet";
import { useNotionPagePicker } from "../../components/NotionPagePickerSheet";
import { useGoogleFilePicker } from "../../components/GoogleFilePickerSheet";
import { useSlackMessagePicker } from "../../components/SlackMessagePickerSheet";
import { discordEnvironment } from "../../state/discord";
import { tryOpenExternalUrl, type ExternalUrlTarget } from "../../lib/openExternalUrl";
import { granolaEnvironment } from "../../state/granola";
import { notionEnvironment } from "../../state/notion";
import { googleEnvironment } from "../../state/google";
import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { ThreadLinkWatchingMark, useThreadLinkWatch } from "./useThreadLinkWatch";

const OPEN_ACTION = "link:open";
const CHANGE_ACTION = "link:change";
const UNLINK_ACTION = "link:unlink";
export const LINK_SLACK_ACTION = "tab:link-slack";
export const LINK_DISCORD_ACTION = "tab:link-discord";
export const LINK_NOTION_ACTION = "tab:link-notion";
export const LINK_GOOGLE_ACTION = "tab:link-google";
export const LINK_GRANOLA_ACTION = "tab:link-granola";

/**
 * The Slack thread, Discord thread, Notion page, and Granola note linked to the thread's tab group, with their link pickers.
 * Linking needs the integration on, a server that answers with links (older servers have none),
 * and the orchestration grant; the server still authorizes every change.
 */
export function useThreadSlackNotionLinks(environmentId: EnvironmentId, threadId: ThreadId) {
  const slackLinks = useEnvironmentQuery(
    slackEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const discordLinks = useEnvironmentQuery(
    discordEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const notionLinks = useEnvironmentQuery(
    notionEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const googleLinks = useEnvironmentQuery(
    googleEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const granolaLinks = useEnvironmentQuery(
    granolaEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const canEditSlack = useAtomValue(slackEnvironment.linkThread.permissionAtom(environmentId));
  const canEditDiscord = useAtomValue(discordEnvironment.linkThread.permissionAtom(environmentId));
  const canEditNotion = useAtomValue(notionEnvironment.linkThread.permissionAtom(environmentId));
  const canEditGoogle = useAtomValue(googleEnvironment.linkThread.permissionAtom(environmentId));
  const canEditGranola = useAtomValue(granolaEnvironment.linkThread.permissionAtom(environmentId));
  const slackPicker = useSlackMessagePicker({ mode: "link", environmentId, threadId });
  const discordPicker = useDiscordMessagePicker({ mode: "link", environmentId, threadId });
  const notionPicker = useNotionPagePicker({ mode: "link", environmentId, threadId });
  const googlePicker = useGoogleFilePicker({ mode: "link", environmentId, threadId });
  const granolaPicker = useGranolaNotePicker({ mode: "link", environmentId, threadId });
  const slackLink = slackLinkForThread(slackLinks, threadId);
  const discordLink = discordLinkForThread(discordLinks, threadId);
  const notionLink = notionLinkForThread(notionLinks, threadId);
  const googleLink = googleLinkForThread(googleLinks, threadId);
  const granolaLink = granolaLinkForThread(granolaLinks, threadId);
  const openSlackPicker = canEditSlack && slackLinks != null ? slackPicker.open : undefined;
  const openDiscordPicker = canEditDiscord && discordLinks != null ? discordPicker.open : undefined;
  const openNotionPicker = canEditNotion && notionLinks != null ? notionPicker.open : undefined;
  const openGooglePicker = canEditGoogle && googleLinks != null ? googlePicker.open : undefined;
  const openGranolaPicker = canEditGranola && granolaLinks != null ? granolaPicker.open : undefined;
  return {
    environmentId,
    threadId,
    slackLink,
    discordLink,
    notionLink,
    googleLink,
    granolaLink,
    canEditSlack,
    canEditDiscord,
    canEditNotion,
    canEditGoogle,
    canEditGranola,
    /** Opens the Slack link picker; undefined when linking is unavailable. */
    openSlackPicker,
    openDiscordPicker,
    openNotionPicker,
    openGooglePicker,
    openGranolaPicker,
    /** Tab-menu items for links the group does not have yet; the chips change existing ones. */
    menuActions: [
      ...(slackLink === null && openSlackPicker
        ? [{ id: LINK_SLACK_ACTION, title: "Link Slack thread", image: "link" }]
        : []),
      ...(discordLink === null && openDiscordPicker
        ? [{ id: LINK_DISCORD_ACTION, title: "Link Discord thread", image: "link" }]
        : []),
      ...(notionLink === null && openNotionPicker
        ? [{ id: LINK_NOTION_ACTION, title: "Link Notion page", image: "link" }]
        : []),
      ...(googleLink === null && openGooglePicker
        ? [{ id: LINK_GOOGLE_ACTION, title: "Link Google page", image: "link" }]
        : []),
      ...(granolaLink === null && openGranolaPicker
        ? [{ id: LINK_GRANOLA_ACTION, title: "Link Granola note", image: "link" }]
        : []),
    ],
    sheets: (
      <>
        {slackPicker.sheet}
        {discordPicker.sheet}
        {notionPicker.sheet}
        {googlePicker.sheet}
        {granolaPicker.sheet}
      </>
    ),
  };
}

export type ThreadSlackNotionLinks = ReturnType<typeof useThreadSlackNotionLinks>;

/** Handles a tab-menu item from `menuActions`; false when the id is not one of them. */
export function handleSlackNotionMenuAction(links: ThreadSlackNotionLinks, id: string): boolean {
  if (id === LINK_SLACK_ACTION) links.openSlackPicker?.();
  else if (id === LINK_DISCORD_ACTION) links.openDiscordPicker?.();
  else if (id === LINK_NOTION_ACTION) links.openNotionPicker?.();
  else if (id === LINK_GOOGLE_ACTION) links.openGooglePicker?.();
  else if (id === LINK_GRANOLA_ACTION) links.openGranolaPicker?.();
  else return false;
  return true;
}

/** The linked Slack thread, Discord thread, Notion page, and Granola note as chips to open, change, or unlink them. */
export function ThreadSlackNotionLinkChips(props: { readonly links: ThreadSlackNotionLinks }) {
  const { environmentId, threadId, slackLink, discordLink, notionLink, googleLink, granolaLink } =
    props.links;
  const unlinkSlack = useAtomCommand(slackEnvironment.unlinkThread, {
    label: "slack thread unlink",
    reportFailure: false,
  });
  const unlinkDiscord = useAtomCommand(discordEnvironment.unlinkThread, {
    label: "discord thread unlink",
    reportFailure: false,
  });
  const unlinkNotion = useAtomCommand(notionEnvironment.unlinkThread, {
    label: "notion thread unlink",
    reportFailure: false,
  });
  const unlinkGoogle = useAtomCommand(googleEnvironment.unlinkThread, {
    label: "google thread unlink",
    reportFailure: false,
  });
  const unlinkGranola = useAtomCommand(granolaEnvironment.unlinkThread, {
    label: "granola thread unlink",
    reportFailure: false,
  });
  const unlink = async (
    command:
      | typeof unlinkSlack
      | typeof unlinkDiscord
      | typeof unlinkNotion
      | typeof unlinkGoogle
      | typeof unlinkGranola,
    title: string,
  ) => {
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
          environmentId={environmentId}
          threadId={threadId}
          kind="slack"
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
      {discordLink ? (
        <LinkChip
          environmentId={environmentId}
          threadId={threadId}
          kind="discord"
          label={discordLink.channelLabel}
          description={`Linked Discord thread in ${discordLink.channelLabel}: ${discordLink.title}`}
          url={discordLink.url}
          target="discord"
          openTitle="Open in Discord"
          changeTitle="Change Discord thread…"
          unlinkTitle="Unlink Discord thread"
          onChange={props.links.openDiscordPicker}
          onUnlink={
            props.links.canEditDiscord
              ? () => void unlink(unlinkDiscord, "Could not unlink Discord thread")
              : undefined
          }
        />
      ) : null}
      {notionLink ? (
        <LinkChip
          environmentId={environmentId}
          threadId={threadId}
          kind="notion"
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
      {googleLink ? (
        <LinkChip
          environmentId={environmentId}
          threadId={threadId}
          kind="google"
          label={googleLink.title}
          description={`Linked Google page: ${googleLink.title}`}
          url={googleLink.url}
          target="google"
          openTitle="Open in Google"
          changeTitle="Change page…"
          unlinkTitle="Unlink page"
          onChange={props.links.openGooglePicker}
          onUnlink={
            props.links.canEditGoogle
              ? () => void unlink(unlinkGoogle, "Could not unlink page")
              : undefined
          }
        />
      ) : null}
      {granolaLink ? (
        <LinkChip
          environmentId={environmentId}
          threadId={threadId}
          kind="granola"
          label={granolaLink.title}
          description={`Linked Granola note: ${granolaLink.title}`}
          url={granolaLink.url}
          target="granola"
          openTitle="Open in Granola"
          changeTitle="Change note…"
          unlinkTitle="Unlink note"
          onChange={props.links.openGranolaPicker}
          onUnlink={
            props.links.canEditGranola
              ? () => void unlink(unlinkGranola, "Could not unlink note")
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function LinkChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly kind: ThreadLinkKind;
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
  const watch = useThreadLinkWatch({
    environmentId: props.environmentId,
    threadId: props.threadId,
    kind: props.kind,
    url: props.url,
  });
  const onMenuAction = (id: string) => {
    if (watch.handleMenuAction(id)) return;
    if (id === OPEN_ACTION) {
      void tryOpenExternalUrl(props.url, props.target).then((opened) => {
        if (!opened) Alert.alert("Could not open the link", "Try again later.");
      });
    } else if (id === CHANGE_ACTION) props.onChange?.();
    else if (id === UNLINK_ACTION) props.onUnlink?.();
  };

  return (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.description}
      title={props.description}
      actions={[
        { id: OPEN_ACTION, title: props.openTitle, image: "arrow.up.right.square" },
        ...watch.menuActions,
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
        {watch.watching ? <ThreadLinkWatchingMark /> : null}
      </Pressable>
    </Menu>
  );
}
