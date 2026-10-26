import { useAtomValue } from "@effect/atom-react";
import { googleLinkForThread } from "@t3tools/client-runtime/state/google";
import type { EnvironmentId, ScopedThreadRef, GoogleThreadLink } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { googleEnvironment } from "~/state/google";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { GoogleSourceIcon } from "../Icons";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { ThreadLinkRow } from "./ThreadLinkRow";
import { openGoogleFilePicker } from "./GoogleFilePicker";

/** Every Google link in the environment. Null until the server answers, or on servers without links. */
function useGoogleThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : googleEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The Google file, event or email linked to the thread's tab group, if any. */
export function useThreadGoogleLink(threadRef: ScopedThreadRef | null) {
  const links = useGoogleThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : googleLinkForThread(links, threadRef.threadId);
}

export function useUnlinkGoogleFile() {
  const unlinkThread = useAtomCommand(googleEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/** The thread details row for the thread's linked Google file, event or email, showing its title when linked. */
export function GoogleThreadLinkRow(props: { threadRef: ScopedThreadRef; link: GoogleThreadLink }) {
  const { threadRef, link } = props;
  const googleEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableGoogleIntegration,
  );
  const canEdit = useAtomValue(
    googleEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkGoogleFile();

  return (
    <ThreadLinkRow
      watchKind="google"
      linkUrl={link.url}
      icon={<GoogleSourceIcon fileType={link.fileType} className="size-4 shrink-0" />}
      label={link.title}
      accessibleLabel={`Linked Google file, event or email: ${link.title}`}
      threadRef={threadRef}
      url={link.url}
    >
      <MenuItem
        render={<a href={link.url} target="_blank" rel="noreferrer" />}
        onClick={(event) => openLink(event, link.url)}
      >
        <ExternalLinkIcon />
        Open in Google
      </MenuItem>
      {googleEnabled && canEdit ? (
        <MenuItem onClick={() => openGoogleFilePicker(threadRef, "link")}>
          <PencilIcon />
          Change document…
        </MenuItem>
      ) : null}
      {canEdit ? (
        <>
          <MenuSeparator />
          <MenuItem onClick={() => void unlink(threadRef)}>
            <UnlinkIcon />
            Unlink document
          </MenuItem>
        </>
      ) : null}
    </ThreadLinkRow>
  );
}
