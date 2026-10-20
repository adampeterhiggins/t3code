import { MessageDraftError, type MessageDraftId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MessageDrafts from "../../../messageDrafts/MessageDrafts.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, readThread } from "../../threadAccess.ts";
import { MessageDraftsToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const drafts = yield* MessageDrafts.MessageDrafts;

  /**
   * Send and delete name the draft's thread, so `writesThreads` can check the
   * caller may write to it before the draft is touched.
   */
  const draftInThread = Effect.fnUntraced(function* (
    draftId: MessageDraftId,
    threadId: ThreadId | undefined,
  ) {
    const { caller, projection } = yield* readThread(threadId);
    const draft = (yield* drafts.list).find(
      (entry) => entry.id === draftId && entry.threadId === projection.thread.id,
    );
    if (draft === undefined) {
      return yield* new MessageDraftError({
        reason: "not-found",
        detail: "No such draft in this thread. It may have been sent, opened, or deleted.",
      });
    }
    return { caller, draft };
  });

  const writesDraftThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
    handle: (params: P) => Effect.Effect<A, E, R>,
  ) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

  return {
    t3_draft_list: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        // Reading drafts needs the same capability as reading threads.
        const threadId =
          input.threadId === undefined
            ? (yield* readCaller(), undefined)
            : (yield* readThread(input.threadId)).projection.thread.id;
        const all = yield* drafts.list;
        return {
          drafts: threadId === undefined ? all : all.filter((draft) => draft.threadId === threadId),
        };
      }),
    ),
    t3_draft_create: writesDraftThread((input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        return yield* drafts.save({
          threadId: projection.thread.id,
          text: input.text,
          attachments: input.attachments ?? [],
          origin: "agent",
        });
      }),
    ),
    t3_draft_send: writesDraftThread((input) =>
      Effect.gen(function* () {
        const { caller, draft } = yield* draftInThread(input.draftId, input.threadId);
        return yield* drafts.send(
          { draftId: draft.id, mode: input.mode ?? "auto" },
          {
            createdBy: "agent",
            creationSource: "mcp",
            ...(caller === undefined ? {} : { senderThreadId: caller.id }),
          },
        );
      }),
    ),
    t3_draft_delete: writesDraftThread((input) =>
      Effect.gen(function* () {
        const { draft } = yield* draftInThread(input.draftId, input.threadId);
        yield* drafts.delete(draft.id);
        return {};
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof MessageDraftsToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(MessageDraftsToolkit, make);
