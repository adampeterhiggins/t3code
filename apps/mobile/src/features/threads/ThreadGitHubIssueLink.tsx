import { useAtomValue } from "@effect/atom-react";
import { gitHubIssueLinkForThread } from "@t3tools/client-runtime/state/github-issues";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GitHubIssueThreadLink, ThreadId } from "@t3tools/contracts";
import { Alert, Pressable, Text, View } from "react-native";

import { ControlPillMenu } from "../../components/ControlPillMenu";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { gitHubIssueEnvironment } from "../../state/githubIssues";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

const OPEN_ACTION = "github-issue:open";
const CHANGE_ACTION = "github-issue:change";
const UNLINK_ACTION = "github-issue:unlink";

/** Green open, purple closed, the way GitHub colours issues; matches the composer chip. */
const STATE_COLORS = { open: "#009f6e", closed: "#8a70dd" } as const;

/** The GitHub issue linked to the thread's tab group, if any. Older servers have no links. */
export function useThreadGitHubIssueLink(environmentId: EnvironmentId, threadId: ThreadId) {
  const links = useEnvironmentQuery(
    gitHubIssueEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
  const canEdit = useAtomValue(gitHubIssueEnvironment.linkThread.permissionAtom(environmentId));
  const link = gitHubIssueLinkForThread(links, threadId);
  return { link, canLink: canEdit && links != null && link === null, canEdit };
}

/**
 * The linked issue's number and live state. State is read from GitHub when the chip mounts and
 * cached for a minute; the link's stored number and title stand in when it is unavailable.
 */
export function ThreadGitHubIssueLinkChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly link: GitHubIssueThreadLink;
  /** Opens the picker to link a different issue; omitted where issues cannot be listed. */
  readonly onChange?: () => void;
}) {
  const { environmentId, threadId, link, onChange } = props;
  const summary = useEnvironmentQuery(
    gitHubIssueEnvironment.issueSummary({ environmentId, input: { url: link.url } }),
  ).data;
  const unlinkThread = useAtomCommand(gitHubIssueEnvironment.unlinkThread, {
    label: "github issue thread unlink",
    reportFailure: false,
  });
  const canEdit = useAtomValue(gitHubIssueEnvironment.unlinkThread.permissionAtom(environmentId));
  const title = summary?.title ?? link.title;
  const label = `${link.repository}#${link.number}`;

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
      void tryOpenExternalUrl(link.url, "github-issue").then((opened) => {
        if (!opened) Alert.alert("Could not open GitHub", "Try again later.");
      });
    } else if (id === CHANGE_ACTION) onChange?.();
    else if (id === UNLINK_ACTION) void unlink();
  };

  return (
    <ControlPillMenu
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Linked GitHub issue ${label}: ${title}`}
      title={`${label} ${title}`}
      actions={[
        { id: OPEN_ACTION, title: "Open on GitHub", image: "arrow.up.right.square" },
        ...(canEdit && onChange
          ? [{ id: CHANGE_ACTION, title: "Change issue…", image: "pencil" }]
          : []),
        ...(canEdit
          ? [
              {
                id: UNLINK_ACTION,
                title: "Unlink issue",
                image: "link",
                attributes: { destructive: true },
              },
            ]
          : []),
      ]}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <Pressable
        accessibilityLabel={`Linked GitHub issue ${label}: ${title}`}
        accessibilityRole="button"
        className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
      >
        <Text className="text-sm font-medium tabular-nums text-foreground">#{link.number}</Text>
        {summary ? (
          <>
            <View
              className="size-2 rounded-full"
              style={{ backgroundColor: STATE_COLORS[summary.state] }}
            />
            <Text className="text-sm text-muted-foreground">
              {summary.state === "open" ? "Open" : "Closed"}
            </Text>
          </>
        ) : null}
      </Pressable>
    </ControlPillMenu>
  );
}
