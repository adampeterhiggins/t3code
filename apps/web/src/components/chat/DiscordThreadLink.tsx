import { useAtomValue } from "@effect/atom-react";
import { discordLinkForThread } from "@t3tools/client-runtime/state/discord";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "~/state/query";
import { discordEnvironment } from "~/state/discord";
import { useAtomCommand } from "~/state/use-atom-command";
import { DiscordIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { openDiscordMessagePicker } from "./DiscordMessagePicker";

/** Every Discord link in the environment. Null until the server answers, or on servers without links. */
export function useDiscordThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : discordEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The Discord thread linked to the thread's tab group, if any. */
export function useThreadDiscordLink(threadRef: ScopedThreadRef | null) {
  const links = useDiscordThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : discordLinkForThread(links, threadRef.threadId);
}

export function useUnlinkDiscordThread() {
  const unlinkThread = useAtomCommand(discordEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/**
 * The chat header's chip for the thread's linked Discord thread: its channel, with the linked
 * message's first line on hover. Discord threads have no status, so nothing is read live.
 */
export function DiscordThreadLinkChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const link = useThreadDiscordLink(threadRef);
  const discordEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableDiscordIntegration,
  );
  const canEdit = useAtomValue(
    discordEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkDiscordThread();
  if (link === null) return null;
  const description = `${link.authorName}: ${link.title}`;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={`Linked Discord thread in ${link.channelLabel}: ${description}`}
            title={description}
          />
        }
      >
        <DiscordIcon />
        <span className="max-w-32 truncate">{link.channelLabel}</span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          render={<a href={link.url} target="_blank" rel="noreferrer" />}
          onClick={(event) => openLink(event, link.url)}
        >
          <ExternalLinkIcon />
          Open in Discord
        </MenuItem>
        {discordEnabled && canEdit ? (
          <MenuItem onClick={() => openDiscordMessagePicker(threadRef, "link")}>
            <PencilIcon />
            Change Discord thread…
          </MenuItem>
        ) : null}
        {canEdit ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => void unlink(threadRef)}>
              <UnlinkIcon />
              Unlink Discord thread
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
