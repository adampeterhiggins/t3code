import { linearLinkForThread } from "@t3tools/client-runtime/state/linear";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, LinearThreadLink, ThreadId } from "@t3tools/contracts";
import { Alert, Pressable, Text, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { linearEnvironment } from "../../state/linear";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

const OPEN_ACTION = "linear:open";
const CHANGE_ACTION = "linear:change";
const UNLINK_ACTION = "linear:unlink";

/**
 * The thread's linked Linear issue, and whether one can be linked: Linear is connected and the
 * server answered with its links (older servers have none).
 */
export function useThreadLinearLink(environmentId: EnvironmentId, threadId: ThreadId) {
  const connection = useEnvironmentQuery(
    linearEnvironment.connection({ environmentId, input: {} }),
  ).data;
  const links = useEnvironmentQuery(
    linearEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const link = linearLinkForThread(links, threadId);
  return {
    link,
    canLink: link === null && links !== null && connection?.phase === "connected",
  };
}

/**
 * The linked issue's identifier and live status. Status is read from Linear when the chip mounts
 * and cached for a minute; the link's stored identifier and title stand in when it is unavailable.
 */
export function ThreadLinearLinkChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly link: LinearThreadLink;
  readonly onChange: () => void;
}) {
  const { environmentId, threadId, link } = props;
  const summary = useEnvironmentQuery(
    linearEnvironment.issueSummary({ environmentId, input: { id: link.issueId } }),
  ).data;
  const unlinkThread = useAtomCommand(linearEnvironment.unlinkThread, {
    label: "linear thread unlink",
    reportFailure: false,
  });
  const identifier = summary?.identifier ?? link.identifier;
  const title = summary?.title ?? link.title;
  const url = summary?.url ?? link.url;

  const unlink = async () => {
    const result = await unlinkThread({ environmentId, input: { threadId } });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      Alert.alert(
        "Could not unlink issue",
        error instanceof Error && error.message.trim() ? error.message : "Try again.",
      );
    }
  };
  const onMenuAction = (id: string) => {
    if (id === OPEN_ACTION) {
      void tryOpenExternalUrl(url, "linear").then((opened) => {
        if (!opened) Alert.alert("Could not open Linear", "Try again later.");
      });
    } else if (id === CHANGE_ACTION) props.onChange();
    else if (id === UNLINK_ACTION) void unlink();
  };

  return (
    <ControlPillMenu
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Linked Linear issue ${identifier}: ${title}`}
      title={`${identifier} ${title}`}
      actions={[
        { id: OPEN_ACTION, title: "Open in Linear", image: "arrow.up.right.square" },
        { id: CHANGE_ACTION, title: "Change issue…", image: "pencil" },
        {
          id: UNLINK_ACTION,
          title: "Unlink issue",
          image: "link",
          attributes: { destructive: true },
        },
      ]}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <Pressable
        accessibilityLabel={`Linked Linear issue ${identifier}: ${title}`}
        accessibilityRole="button"
        className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
      >
        <Text className="text-sm font-medium tabular-nums text-foreground">{identifier}</Text>
        {summary ? (
          <>
            <View className="size-2 rounded-full" style={{ backgroundColor: summary.stateColor }} />
            <Text numberOfLines={1} className="max-w-28 text-sm text-muted-foreground">
              {summary.stateName}
            </Text>
          </>
        ) : null}
      </Pressable>
    </ControlPillMenu>
  );
}

/** The way in when the thread has no issue and its tabs have no menu to hold the action. */
export function ThreadLinearLinkButton(props: { readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Link Linear issue"
      accessibilityRole="button"
      onPress={props.onPress}
      className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
    >
      <SymbolView name="link" size={13} tintColorClassName="accent-foreground" />
      <Text className="text-sm font-medium text-foreground">Link issue</Text>
    </Pressable>
  );
}
