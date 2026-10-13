import { useAtomValue } from "@effect/atom-react";
import { granolaLinkForThread } from "@t3tools/client-runtime/state/granola";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { granolaEnvironment } from "~/state/granola";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { GranolaIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { openGranolaNotePicker } from "./GranolaNotePicker";

/** Every Granola link in the environment. Null until the server answers, or on servers without links. */
export function useGranolaThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : granolaEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The Granola note linked to the thread's tab group, if any. */
export function useThreadGranolaLink(threadRef: ScopedThreadRef | null) {
  const links = useGranolaThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : granolaLinkForThread(links, threadRef.threadId);
}

export function useUnlinkGranolaNote() {
  const unlinkThread = useAtomCommand(granolaEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/** The chat header's chip for the thread's linked Granola note, showing its title when linked. */
export function GranolaThreadLinkChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const link = useThreadGranolaLink(threadRef);
  const granolaEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableGranolaIntegration,
  );
  const canEdit = useAtomValue(
    granolaEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkGranolaNote();
  if (link === null) return null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={`Linked Granola note: ${link.title}`}
            title={link.title}
          />
        }
      >
        <GranolaIcon />
        <span className="max-w-32 truncate">{link.title}</span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          render={<a href={link.url} target="_blank" rel="noreferrer" />}
          onClick={(event) => openLink(event, link.url)}
        >
          <ExternalLinkIcon />
          Open in Granola
        </MenuItem>
        {granolaEnabled && canEdit ? (
          <MenuItem onClick={() => openGranolaNotePicker(threadRef, "link")}>
            <PencilIcon />
            Change note…
          </MenuItem>
        ) : null}
        {canEdit ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => void unlink(threadRef)}>
              <UnlinkIcon />
              Unlink note
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
