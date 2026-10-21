import { useAtomValue } from "@effect/atom-react";
import { granolaLinkForThread } from "@t3tools/client-runtime/state/granola";
import type { EnvironmentId, ScopedThreadRef, GranolaThreadLink } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { granolaEnvironment } from "~/state/granola";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { GranolaIcon } from "../Icons";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { ThreadLinkRow } from "./ThreadLinkRow";
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

/** The thread details row for the thread's linked Granola note, showing its title when linked. */
export function GranolaThreadLinkRow(props: {
  threadRef: ScopedThreadRef;
  link: GranolaThreadLink;
}) {
  const { threadRef, link } = props;
  const granolaEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableGranolaIntegration,
  );
  const canEdit = useAtomValue(
    granolaEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkGranolaNote();

  return (
    <ThreadLinkRow
      icon={<GranolaIcon className="size-4 shrink-0" />}
      label={link.title}
      accessibleLabel={`Linked Granola note: ${link.title}`}
      title={link.title}
    >
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
    </ThreadLinkRow>
  );
}
