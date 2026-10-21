import type { ScopedThreadRef } from "@t3tools/contracts";
import { parseComposerObjectLink } from "@t3tools/shared/composerObjectLinks";
import { useState, type ReactNode } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { ContextPreviewBody } from "../contextPreviewRegistry";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { CursorPreviewCard } from "./CursorPreviewCard";
import {
  isPreviewableObjectLink,
  useLinkedObjectRecord,
  type PreviewableObjectLink,
} from "./LinkedObjectLinkPreview";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";

/**
 * One linked item in the thread details panel's Links section; its menu holds the link's actions.
 * Hovering it shows the card a chip for the same link would show.
 */
export function ThreadLinkRow(props: {
  threadRef: ScopedThreadRef;
  url: string;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  accessibleLabel: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const objectLink = parseComposerObjectLink(props.url);
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
                  aria-label={props.accessibleLabel}
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
        <MenuPopup align="end">{props.children}</MenuPopup>
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
