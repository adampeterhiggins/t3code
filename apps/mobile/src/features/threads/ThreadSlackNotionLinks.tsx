import { useAtomValue } from "@effect/atom-react";
import { discordLinkForThread } from "@t3tools/client-runtime/state/discord";
import { granolaLinkForThread } from "@t3tools/client-runtime/state/granola";
import { notionLinkForThread } from "@t3tools/client-runtime/state/notion";
import { googleLinkForThread } from "@t3tools/client-runtime/state/google";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { slackLinkForThread } from "@t3tools/client-runtime/state/slack";
import type { EnvironmentId, ThreadId, ThreadLinkKind } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
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
  const gt = useGT();
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
        ? [{ id: LINK_SLACK_ACTION, title: gt("Link Slack thread"), image: "link" }]
        : []),
      ...(discordLink === null && openDiscordPicker
        ? [{ id: LINK_DISCORD_ACTION, title: gt("Link Discord thread"), image: "link" }]
        : []),
      ...(notionLink === null && openNotionPicker
        ? [{ id: LINK_NOTION_ACTION, title: gt("Link Notion page"), image: "link" }]
        : []),
      ...(googleLink === null && openGooglePicker
        ? [{ id: LINK_GOOGLE_ACTION, title: gt("Link Google file, event or email"), image: "link" }]
        : []),
      ...(granolaLink === null && openGranolaPicker
        ? [{ id: LINK_GRANOLA_ACTION, title: gt("Link Granola note"), image: "link" }]
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
  const gt = useGT();
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
      error instanceof Error && error.message.trim() ? error.message : gt("Try again."),
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
          description={gt("Linked Slack thread in {channel}: {title}", {
            channel: slackLink.channelLabel,
            title: slackLink.title,
          })}
          url={slackLink.url}
          target="slack"
          openTitle={gt("Open in Slack")}
          changeTitle={gt("Change Slack thread…")}
          unlinkTitle={gt("Unlink Slack thread")}
          onChange={props.links.openSlackPicker}
          onUnlink={
            props.links.canEditSlack
              ? () => void unlink(unlinkSlack, gt("Could not unlink Slack thread"))
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
          description={gt("Linked Discord thread in {channel}: {title}", {
            channel: discordLink.channelLabel,
            title: discordLink.title,
          })}
          url={discordLink.url}
          target="discord"
          openTitle={gt("Open in Discord")}
          changeTitle={gt("Change Discord thread…")}
          unlinkTitle={gt("Unlink Discord thread")}
          onChange={props.links.openDiscordPicker}
          onUnlink={
            props.links.canEditDiscord
              ? () => void unlink(unlinkDiscord, gt("Could not unlink Discord thread"))
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
          description={gt("Linked Notion page: {title}", { title: notionLink.title })}
          url={notionLink.url}
          target="notion"
          openTitle={gt("Open in Notion")}
          changeTitle={gt("Change page…")}
          unlinkTitle={gt("Unlink page")}
          onChange={props.links.openNotionPicker}
          onUnlink={
            props.links.canEditNotion
              ? () => void unlink(unlinkNotion, gt("Could not unlink page"))
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
          description={gt("Linked Google file, event or email: {title}", {
            title: googleLink.title,
          })}
          url={googleLink.url}
          target="google"
          openTitle={gt("Open in Google")}
          changeTitle={gt("Change page…")}
          unlinkTitle={gt("Unlink page")}
          onChange={props.links.openGooglePicker}
          onUnlink={
            props.links.canEditGoogle
              ? () => void unlink(unlinkGoogle, gt("Could not unlink page"))
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
          description={gt("Linked Granola note: {title}", { title: granolaLink.title })}
          url={granolaLink.url}
          target="granola"
          openTitle={gt("Open in Granola")}
          changeTitle={gt("Change note…")}
          unlinkTitle={gt("Unlink note")}
          onChange={props.links.openGranolaPicker}
          onUnlink={
            props.links.canEditGranola
              ? () => void unlink(unlinkGranola, gt("Could not unlink note"))
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
  const gt = useGT();
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
        if (!opened) Alert.alert(gt("Could not open the link"), gt("Try again later."));
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
