import type { MessageDraftOrigin, MessageDraftSendMode } from "@t3tools/contracts";
import { draftMenuLabel } from "@t3tools/client-runtime/state/send-menu";

import type { FollowUpBehavior } from "../../lib/followUpBehavior";

/** What the tray's send button does: the same choice the composer's send button would make. */
export function defaultMessageDraftSendMode(input: {
  readonly running: boolean;
  readonly canSteer: boolean;
  readonly followUpBehavior: FollowUpBehavior;
}): MessageDraftSendMode {
  if (!input.running) return "auto";
  return input.canSteer ? input.followUpBehavior : "queue";
}

const ORIGIN_LABEL: Record<MessageDraftOrigin, string | null> = {
  // Drafts saved on this phone need no provenance.
  mobile: null,
  web: "Web",
  desktop: "Desktop",
  agent: "Agent",
};

export function messageDraftRowPresentation(draft: {
  readonly text: string;
  readonly attachments: ReadonlyArray<unknown>;
  readonly origin: MessageDraftOrigin;
}): {
  readonly title: string;
  readonly attachmentCount: number;
  readonly originLabel: string | null;
} {
  const hasText = draft.text.trim().length > 0;
  return {
    title: hasText || draft.attachments.length === 0 ? draftMenuLabel(draft.text) : "Attachments",
    attachmentCount: draft.attachments.length,
    originLabel: ORIGIN_LABEL[draft.origin],
  };
}
