import { useAtomValue } from "@effect/atom-react";
import { threadLinkWatchFor } from "@t3tools/client-runtime/state/threadLinkWatches";
import type { ScopedThreadRef, ThreadLinkKind } from "@t3tools/contracts";
import { parseComposerObjectLink } from "@t3tools/shared/composerObjectLinks";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { threadLinkWatchEnvironment } from "~/state/threadLinkWatches";
import { useAtomCommand } from "~/state/use-atom-command";
import { ContextPreviewBody } from "../contextPreviewRegistry";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { CursorPreviewCard } from "./CursorPreviewCard";
import {
  isPreviewableObjectLink,
  useLinkedObjectRecord,
  type PreviewableObjectLink,
} from "./LinkedObjectLinkPreview";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";

/** The thread's watch of its link of `kind`, or null. Null too on servers without link watches. */
function useThreadLinkWatch(threadRef: ScopedThreadRef, kind: ThreadLinkKind) {
  const watches = useEnvironmentQuery(
    threadLinkWatchEnvironment.watches({ environmentId: threadRef.environmentId, input: {} }),
  ).data;
  return {
    supported: watches != null,
    watch: threadLinkWatchFor(watches, threadRef.threadId, kind),
  };
}

/**
 * One linked item in the thread details panel's Links section; its menu holds the link's actions.
 * Hovering it shows the card a chip for the same link would show. An eye marks a link the
 * thread's agent is woken by when it changes.
 */
export function ThreadLinkRow(props: {
  threadRef: ScopedThreadRef;
  url: string;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  accessibleLabel: string;
  watchKind: ThreadLinkKind;
  /** The link as stored, which a watch records; `url` may be a live read of it. */
  linkUrl: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const objectLink = parseComposerObjectLink(props.url);
  const { supported, watch } = useThreadLinkWatch(props.threadRef, props.watchKind);
  const canWatch = useAtomValue(
    threadLinkWatchEnvironment.setWatching.permissionAtom(props.threadRef.environmentId),
  );
  const setWatching = useAtomCommand(threadLinkWatchEnvironment.setWatching);
  // A watch of a link this row no longer shows ends on the server's next read.
  const watching = watch !== null && watch.url === props.linkUrl;
  const toggleWatch = () =>
    void setWatching({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, kind: props.watchKind, watching: !watching },
    });
  return (
    <li className="flex h-8 items-center">
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <CursorPreviewCard
          suppressed={menuOpen}
          trigger={
            <MenuTrigger
              render={
                <ThreadDetailsControl
                  variant="ghost"
                  size="sm"
                  part="row"
                  aria-label={
                    watching
                      ? `${props.accessibleLabel}. Watching for changes`
                      : props.accessibleLabel
                  }
                />
              }
            >
              {props.icon}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left",
                  THREAD_DETAILS_PANEL_LABEL_CLASS,
                )}
              >
                {props.label}
              </span>
              {watching ? (
                <EyeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              {props.trailing}
            </MenuTrigger>
          }
        >
          {isPreviewableObjectLink(objectLink) ? (
            <ThreadLinkPreviewBody threadRef={props.threadRef} objectLink={objectLink} />
          ) : (
            <p className="break-all text-muted-foreground">{props.url}</p>
          )}
        </CursorPreviewCard>
        <MenuPopup align="end">
          {supported && canWatch ? (
            <>
              <MenuItem onClick={toggleWatch}>
                {watching ? <EyeOffIcon /> : <EyeIcon />}
                {watching ? "Stop watching" : "Watch for changes"}
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          {props.children}
        </MenuPopup>
      </Menu>
    </li>
  );
}

/** Mounts only while the card is open, so the linked object is read on hover, not per row. */
function ThreadLinkPreviewBody(props: {
  threadRef: ScopedThreadRef;
  objectLink: PreviewableObjectLink;
}) {
  const openLink = useLinkClickHandler(props.threadRef);
  const { available, record, failed } = useLinkedObjectRecord(
    props.threadRef.environmentId,
    props.objectLink,
    true,
  );
  if (record !== null) {
    return <ContextPreviewBody kind={record.kind} preview={{ record, onOpenLink: openLink }} />;
  }
  if (available && !failed) return <p className="text-muted-foreground">Loading…</p>;
  return <p className="break-all text-muted-foreground">{props.objectLink.url}</p>;
}
