import { useAtomValue } from "@effect/atom-react";
import { linearLinkForThread } from "@t3tools/client-runtime/state/linear";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinearLinkClickHandler } from "~/browser/useLinearLinkClickHandler";
import { useLinkClickHandler } from "~/browser/useOpenLink";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LinearIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { openLinearIssuePicker } from "./LinearIssuePicker";

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
 * The chat header's chip for the thread's linked Linear issue, with its current status. Status is
 * read from Linear when the chip mounts and cached for a minute; the link itself stays put when
 * Linear is unreachable.
 */
export function LinearThreadLinkChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const link = useThreadLinearLink(threadRef);
  const summary = useEnvironmentQuery(
    link === null
      ? null
      : linearEnvironment.issueSummary({
          environmentId: threadRef.environmentId,
          input: { id: link.issueId },
        }),
  ).data;
  const openLink = useLinearLinkClickHandler(useLinkClickHandler(threadRef));
  const unlink = useUnlinkLinearIssue();
  const canEdit = useAtomValue(
    linearEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  if (link === null) return null;
  const title = summary?.title ?? link.title;
  const url = summary?.url ?? link.url;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={`Linked Linear issue ${link.identifier}: ${title}`}
            title={title}
          />
        }
      >
        <LinearIcon />
        <span className="tabular-nums">{summary?.identifier ?? link.identifier}</span>
        {summary ? (
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: summary.stateColor }}
            />
            <span className="max-w-28 truncate">{summary.stateName}</span>
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end">
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
      </MenuPopup>
    </Menu>
  );
}
