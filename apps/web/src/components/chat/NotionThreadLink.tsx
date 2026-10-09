import { useAtomValue } from "@effect/atom-react";
import { notionLinkForThread } from "@t3tools/client-runtime/state/notion";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { notionEnvironment } from "~/state/notion";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { NotionIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { openNotionPagePicker } from "./NotionPagePicker";

/** Every Notion link in the environment. Null until the server answers, or on servers without links. */
export function useNotionThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : notionEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The Notion page linked to the thread's tab group, if any. */
export function useThreadNotionLink(threadRef: ScopedThreadRef | null) {
  const links = useNotionThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : notionLinkForThread(links, threadRef.threadId);
}

export function useUnlinkNotionPage() {
  const unlinkThread = useAtomCommand(notionEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/** The chat header's chip for the thread's linked Notion page, showing its title when linked. */
export function NotionThreadLinkChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const link = useThreadNotionLink(threadRef);
  const notionEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableNotionIntegration,
  );
  const canEdit = useAtomValue(
    notionEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkNotionPage();
  if (link === null) return null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={`Linked Notion page: ${link.title}`}
            title={link.title}
          />
        }
      >
        <NotionIcon />
        <span className="max-w-32 truncate">{link.title}</span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          render={<a href={link.url} target="_blank" rel="noreferrer" />}
          onClick={(event) => openLink(event, link.url)}
        >
          <ExternalLinkIcon />
          Open in Notion
        </MenuItem>
        {notionEnabled && canEdit ? (
          <MenuItem onClick={() => openNotionPagePicker(threadRef, "link")}>
            <PencilIcon />
            Change page…
          </MenuItem>
        ) : null}
        {canEdit ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => void unlink(threadRef)}>
              <UnlinkIcon />
              Unlink page
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
