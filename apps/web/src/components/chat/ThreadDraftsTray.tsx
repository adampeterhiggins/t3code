import { useAtomValue } from "@effect/atom-react";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import type {
  ContextMenuItem,
  MessageDraft,
  MessageDraftId,
  MessageDraftSendMode,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowUpIcon,
  BotIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useId, useState, type MouseEvent } from "react";

import { readLocalApi } from "../../localApi";
import { messageDraftEnvironment, useThreadMessageDrafts } from "../../state/messageDrafts";
import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";
import { InlineChipText } from "./InlineChipText";
import { useMessageDraftActions } from "./useMessageDraftActions";

/** More drafts than this start folded, so the tray does not push the timeline away. */
const EXPANDED_DRAFT_LIMIT = 3;

type DraftRowAction = "open" | "send" | "queue" | "steer" | "delete";

const ORIGIN_PRESENTATION = {
  mobile: { Icon: SmartphoneIcon, label: "Saved on a phone" },
  agent: { Icon: BotIcon, label: "Saved by an agent" },
} as const;

/** Drafts saved in this thread, to open in the composer or send as they are. */
export function ThreadDraftsTray(props: {
  readonly threadRef: ScopedThreadRef;
  readonly running: boolean;
  /** False while the active turn cannot take steering, such as during compaction. */
  readonly canSteer: boolean;
  readonly followUpBehavior: "queue" | "steer";
  readonly onOpen: (draftId: MessageDraftId) => void;
}) {
  const { threadRef, running, canSteer } = props;
  const drafts = useThreadMessageDrafts(threadRef);
  const canOpen = useAtomValue(
    messageDraftEnvironment.take.permissionAtom(threadRef.environmentId),
  );
  const canSend = useAtomValue(
    messageDraftEnvironment.send.permissionAtom(threadRef.environmentId),
  );
  const canDelete = useAtomValue(
    messageDraftEnvironment.remove.permissionAtom(threadRef.environmentId),
  );
  const actions = useMessageDraftActions();
  const listId = useId();
  const [expandedChoice, setExpandedChoice] = useState<boolean | null>(null);
  const [busyDraftId, setBusyDraftId] = useState<MessageDraftId | null>(null);
  if (drafts.length === 0) return null;
  const expanded = expandedChoice ?? drafts.length <= EXPANDED_DRAFT_LIMIT;
  const canSteerNow = running && canSteer;
  // Sending a draft behaves like pressing send: start a turn when idle, otherwise follow the
  // follow-up setting.
  const defaultSendMode: MessageDraftSendMode =
    resolveComposerDispatchMode({
      running,
      alternateModifier: false,
      activeTurnDefault: props.followUpBehavior,
      canSteer,
    }) === "steer"
      ? "steer"
      : running
        ? "queue"
        : "auto";

  const run = async (draft: MessageDraft, action: DraftRowAction) => {
    if (busyDraftId !== null) return;
    if (action === "open") {
      props.onOpen(draft.id);
      return;
    }
    setBusyDraftId(draft.id);
    if (action === "delete") {
      await actions.remove(threadRef.environmentId, draft.id);
    } else {
      await actions.send(
        threadRef.environmentId,
        draft.id,
        action === "send" ? defaultSendMode : action,
      );
    }
    setBusyDraftId(null);
  };

  const openRowMenu = async (event: MouseEvent, draft: MessageDraft) => {
    event.preventDefault();
    const api = readLocalApi();
    if (!api || busyDraftId !== null) return;
    const items: ContextMenuItem<DraftRowAction>[] = [
      { id: "open", label: "Open in composer", icon: "pencil", disabled: !canOpen },
      // While a turn takes steering, both follow-ups are offered, as on the send button.
      ...(canSteerNow
        ? [
            {
              id: "queue" as const,
              label: "Queue",
              icon: "list-plus",
              checked: defaultSendMode === "queue",
              disabled: !canSend,
            },
            {
              id: "steer" as const,
              label: "Steer now",
              icon: "corner-up-right",
              checked: defaultSendMode === "steer",
              disabled: !canSend,
            },
          ]
        : [
            {
              id: "send" as const,
              label: defaultSendMode === "queue" ? "Queue" : "Send",
              icon: defaultSendMode === "queue" ? "list-plus" : "arrow-up",
              disabled: !canSend,
            },
          ]),
      {
        id: "delete",
        label: "Delete draft",
        icon: "trash",
        destructive: true,
        separatorBefore: true,
        disabled: !canDelete,
      },
    ];
    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    if (action !== null) await run(draft, action);
  };

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        role="region"
        aria-label={`${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}
        className="relative z-0"
      >
        <ComposerBanner.Row
          render={<button type="button" />}
          aria-label={expanded ? "Collapse drafts" : "Expand drafts"}
          aria-expanded={expanded}
          aria-controls={listId}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setExpandedChoice(!expanded)}
        >
          <ComposerBanner.Icon>
            <FileTextIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="text-muted-foreground">Drafts</ComposerBanner.Content>
          <ComposerBanner.Actions>
            <ComposerBanner.Count>{drafts.length}</ComposerBanner.Count>
            <ComposerBanner.ToggleIcon expanded={expanded} />
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        {expanded ? (
          <ComposerBanner.Scroll className="max-h-32">
            <ComposerBanner.Children render={<ol />} id={listId}>
              {drafts.map((draft) => {
                const text = draft.text.trim();
                const imageCount = draft.attachments.filter(
                  (attachment) => attachment.type === "image",
                ).length;
                const fileCount = draft.attachments.length - imageCount;
                const origin =
                  draft.origin === "mobile" || draft.origin === "agent"
                    ? ORIGIN_PRESENTATION[draft.origin]
                    : null;
                const busy = busyDraftId !== null;
                return (
                  <ComposerBanner.Row
                    render={<li />}
                    key={draft.id}
                    aria-busy={busyDraftId === draft.id || undefined}
                    onContextMenu={(event) => void openRowMenu(event, draft)}
                  >
                    <ComposerBanner.Icon />
                    <ComposerBanner.Content className="text-foreground/80">
                      {imageCount > 0 ? (
                        <ImageIcon
                          aria-label={`${imageCount} image${imageCount === 1 ? "" : "s"}`}
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                      {fileCount > 0 ? (
                        <PaperclipIcon
                          aria-label={`${fileCount} file${fileCount === 1 ? "" : "s"}`}
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                          {text.length > 0 ? (
                            <InlineChipText text={text} hideImages={imageCount > 0} />
                          ) : (
                            <span className="text-muted-foreground">Attachments only</span>
                          )}
                        </TooltipTrigger>
                        {text.length > 0 ? (
                          <TooltipPopup side="top" className="max-w-96 break-words">
                            <InlineChipText
                              text={text}
                              hideImages={imageCount > 0}
                              expandCitations
                            />
                          </TooltipPopup>
                        ) : null}
                      </Tooltip>
                    </ComposerBanner.Content>
                    <ComposerBanner.Actions>
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums max-sm:hidden">
                        {origin ? (
                          <origin.Icon aria-label={origin.label} className="size-3" />
                        ) : null}
                        <RelativeTime timestamp={draft.createdAt} />
                      </span>
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        disabled={busy || !canOpen}
                        onClick={() => void run(draft, "open")}
                      >
                        Open
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        disabled={busy || !canSend}
                        onClick={() => void run(draft, "send")}
                      >
                        <ArrowUpIcon />
                        {defaultSendMode === "queue" ? "Queue" : "Send"}
                      </Button>
                      <ComposerBanner.Dismiss
                        aria-label="Delete draft"
                        disabled={busy || !canDelete}
                        onClick={() => void run(draft, "delete")}
                      />
                    </ComposerBanner.Actions>
                  </ComposerBanner.Row>
                );
              })}
            </ComposerBanner.Children>
          </ComposerBanner.Scroll>
        ) : null}
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
