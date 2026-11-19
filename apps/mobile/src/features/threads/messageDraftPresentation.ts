import type { MessageDraftOrigin, MessageDraftSendMode } from "@t3tools/contracts";
import { draftMenuLabel } from "@t3tools/client-runtime/state/send-menu";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";
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
  web: msg("Web", { $context: "where a draft was saved" }),
  desktop: msg("Desktop", { $context: "where a draft was saved" }),
  agent: msg("Agent", { $context: "who saved a draft" }),
};

export function messageDraftRowPresentation(
  draft: {
    readonly text: string;
    readonly attachments: ReadonlyArray<unknown>;
    readonly origin: MessageDraftOrigin;
  },
  resolve: MessageResolver = m,
): {
  readonly title: string;
  readonly attachmentCount: number;
  readonly originLabel: string | null;
} {
  const hasText = draft.text.trim().length > 0;
  const originLabel = ORIGIN_LABEL[draft.origin];
  return {
    title:
      hasText || draft.attachments.length === 0
        ? draftMenuLabel(draft.text, resolve)
        : resolve(msg("Attachments")),
    attachmentCount: draft.attachments.length,
    originLabel: originLabel === null ? null : resolve(originLabel),
  };
}
