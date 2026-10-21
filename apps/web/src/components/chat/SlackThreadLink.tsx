import { useAtomValue } from "@effect/atom-react";
import { slackLinkForThread } from "@t3tools/client-runtime/state/slack";
import type { EnvironmentId, ScopedThreadRef, SlackThreadLink } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";
import { useAtomCommand } from "~/state/use-atom-command";
import { SlackIcon } from "../Icons";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { ThreadLinkRow } from "./ThreadLinkRow";
import { openSlackMessagePicker } from "./SlackMessagePicker";

/** Every Slack link in the environment. Null until the server answers, or on servers without links. */
export function useSlackThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : slackEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The Slack thread linked to the thread's tab group, if any. */
export function useThreadSlackLink(threadRef: ScopedThreadRef | null) {
  const links = useSlackThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : slackLinkForThread(links, threadRef.threadId);
}

export function useUnlinkSlackThread() {
  const unlinkThread = useAtomCommand(slackEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/**
 * The thread details row for the thread's linked Slack thread: the linked message's first line
 * and its channel. Slack threads have no status, so nothing is read live.
 */
export function SlackThreadLinkRow(props: { threadRef: ScopedThreadRef; link: SlackThreadLink }) {
  const { threadRef, link } = props;
  const slackEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableSlackIntegration,
  );
  const canEdit = useAtomValue(slackEnvironment.linkThread.permissionAtom(threadRef.environmentId));
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkSlackThread();
  const description = `${link.authorName}: ${link.title}`;

  return (
    <ThreadLinkRow
      icon={<SlackIcon className="size-4 shrink-0" />}
      label={link.title}
      accessibleLabel={`Linked Slack thread in ${link.channelLabel}: ${description}`}
      title={description}
      trailing={
        <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
          {link.channelLabel}
        </span>
      }
    >
      <MenuItem
        render={<a href={link.url} target="_blank" rel="noreferrer" />}
        onClick={(event) => openLink(event, link.url)}
      >
        <ExternalLinkIcon />
        Open in Slack
      </MenuItem>
      {slackEnabled && canEdit ? (
        <MenuItem onClick={() => openSlackMessagePicker(threadRef, "link")}>
          <PencilIcon />
          Change Slack thread…
        </MenuItem>
      ) : null}
      {canEdit ? (
        <>
          <MenuSeparator />
          <MenuItem onClick={() => void unlink(threadRef)}>
            <UnlinkIcon />
            Unlink Slack thread
          </MenuItem>
        </>
      ) : null}
    </ThreadLinkRow>
  );
}
