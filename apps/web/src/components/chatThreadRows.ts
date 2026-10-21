import type { ChatThreadMessage } from "@t3tools/contracts";

export type ChatThreadRow =
  | { readonly type: "message"; readonly message: ChatThreadMessage }
  | { readonly type: "replies"; readonly count: number }
  /** `from` is the index of the first message left out. */
  | { readonly type: "omitted"; readonly from: number; readonly count: number };

/**
 * A captured thread as its card lays it out: the parent, a rule counting the replies, then the
 * replies. The server always keeps the parent but may leave other messages out to fit; a jump in
 * `index` is a gap.
 */
export function chatThreadRows(
  messages: ReadonlyArray<ChatThreadMessage>,
  replyCount: number,
): ReadonlyArray<ChatThreadRow> {
  const rows: Array<ChatThreadRow> = [];
  let next = 0;
  for (const message of messages) {
    if (message.index > next) {
      rows.push({ type: "omitted", from: next, count: message.index - next });
    }
    rows.push({ type: "message", message });
    if (message.index === 0 && replyCount > 0) rows.push({ type: "replies", count: replyCount });
    next = message.index + 1;
  }
  if (messages.length > 0 && next < replyCount + 1) {
    rows.push({ type: "omitted", from: next, count: replyCount + 1 - next });
  }
  return rows;
}
