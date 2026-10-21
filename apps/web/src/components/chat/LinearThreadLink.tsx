import { useAtomValue } from "@effect/atom-react";
import { linearLinkForThread } from "@t3tools/client-runtime/state/linear";
import type { EnvironmentId, LinearThreadLink, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinearLinkClickHandler } from "~/browser/useLinearLinkClickHandler";
import { useLinkClickHandler } from "~/browser/useOpenLink";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LinearIcon } from "../Icons";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { openLinearIssuePicker } from "./LinearIssuePicker";
import { ThreadLinkRow } from "./ThreadLinkRow";

/** Every Linear link in the environment. Null until the server answers, or on servers without links. */
export function useLinearThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : linearEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The issue linked to the thread's tab group, if any. */
export function useThreadLinearLink(threadRef: ScopedThreadRef | null) {
  const links = useLinearThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : linearLinkForThread(links, threadRef.threadId);
}

export function useUnlinkLinearIssue() {
  const unlinkThread = useAtomCommand(linearEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/**
 * The thread details row for the thread's linked Linear issue, with its current status. Status is
 * read from Linear when the row mounts and cached for a minute; the link itself stays put when
 * Linear is unreachable.
 */
export function LinearThreadLinkRow(props: { threadRef: ScopedThreadRef; link: LinearThreadLink }) {
  const { threadRef, link } = props;
  const summary = useEnvironmentQuery(
    linearEnvironment.issueSummary({
      environmentId: threadRef.environmentId,
      input: { id: link.issueId },
    }),
  ).data;
  const openLink = useLinearLinkClickHandler(useLinkClickHandler(threadRef));
  const unlink = useUnlinkLinearIssue();
  const canEdit = useAtomValue(
    linearEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const title = summary?.title ?? link.title;
  const url = summary?.url ?? link.url;
  const identifier = summary?.identifier ?? link.identifier;

  return (
    <ThreadLinkRow
      icon={<LinearIcon className="size-4 shrink-0" />}
      label={`${identifier} ${title}`}
      accessibleLabel={`Linked Linear issue ${identifier}: ${title}`}
      title={title}
      trailing={
        summary ? (
          <span className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: summary.stateColor }}
            />
            <span className="max-w-24 truncate">{summary.stateName}</span>
          </span>
        ) : null
      }
    >
      <MenuItem
        render={<a href={url} target="_blank" rel="noreferrer" />}
        onClick={(event) => openLink(event, url)}
      >
        <ExternalLinkIcon />
        Open in Linear
      </MenuItem>
      {canEdit ? (
        <>
          <MenuItem onClick={() => openLinearIssuePicker(threadRef, "link")}>
            <PencilIcon />
            Change issue…
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => void unlink(threadRef)}>
            <UnlinkIcon />
            Unlink issue
          </MenuItem>
        </>
      ) : null}
    </ThreadLinkRow>
  );
}
