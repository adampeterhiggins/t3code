import { useAtomValue } from "@effect/atom-react";
import { slackLinkForThread } from "@t3tools/client-runtime/state/slack";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";
import { useAtomCommand } from "~/state/use-atom-command";
import { SlackIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
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
 * The chat header's chip for the thread's linked Slack thread: its channel, with the linked
 * message's first line on hover. Slack threads have no status, so nothing is read live.
 */
export function SlackThreadLinkChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const link = useThreadSlackLink(threadRef);
  const slackEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableSlackIntegration,
  );
  const canEdit = useAtomValue(slackEnvironment.linkThread.permissionAtom(threadRef.environmentId));
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkSlackThread();
  if (link === null) return null;
  const description = `${link.authorName}: ${link.title}`;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={`Linked Slack thread in ${link.channelLabel}: ${description}`}
            title={description}
          />
        }
      >
        <SlackIcon />
        <span className="max-w-32 truncate">{link.channelLabel}</span>
      </MenuTrigger>
      <MenuPopup align="end">
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
      </MenuPopup>
    </Menu>
  );
}
