import {
  ChatAttachment,
  CommandId,
  IsoDateTime,
  type MessageDraft,
  MessageDraftError,
  MessageDraftId,
  MessageDraftOrigin,
  type MessageDrafts as MessageDraftsList,
  type MessageDraftSaveInput,
  type MessageDraftSendInput,
  type MessageDraftSendResult,
  MessageId,
  OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type ProjectId,
  type OrchestrationV2CreationSource,
  ThreadId,
} from "@t3tools/contracts";
import { remapComposerContextAttachments } from "@t3tools/shared/composerContextReferences";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import {
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as AttachmentClaims from "../orchestration-v2/AttachmentClaims.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMessageIntake from "../orchestration-v2/ThreadMessageIntake.ts";

const DraftRow = Schema.Struct({
  id: MessageDraftId,
  threadId: ThreadId,
  text: Schema.String,
  attachments: Schema.fromJsonString(Schema.Array(ChatAttachment)),
  context: Schema.NullOr(Schema.fromJsonString(OrchestrationMessageContext)),
  origin: MessageDraftOrigin,
  createdAt: IsoDateTime,
});
const decodeRow = Schema.decodeUnknownEffect(DraftRow);
const encodeRow = Schema.encodeEffect(DraftRow);

const fromRow = (row: typeof DraftRow.Type): MessageDraft => ({
  id: row.id,
  threadId: row.threadId,
  text: row.text,
  attachments: row.attachments,
  ...(row.context === null ? {} : { context: row.context }),
  origin: row.origin,
  createdAt: row.createdAt,
});

const storageError = (cause: unknown) =>
  new MessageDraftError({ reason: "send-failed", detail: "Could not save the draft.", cause });

const notFound = () =>
  new MessageDraftError({
    reason: "not-found",
    detail: "The draft was already opened, sent, or deleted.",
  });

const isThreadManagementError = Schema.is(ThreadManagement.ThreadManagementError);
const isAttachmentClaimError = Schema.is(AttachmentClaims.AttachmentClaimError);

/** Who sends the draft: the user from a client, or an agent over MCP. */
export interface MessageDraftSender {
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
  readonly senderThreadId?: ThreadId;
}

export class MessageDrafts extends Context.Service<
  MessageDrafts,
  {
    /** Every draft in the environment, newest first, re-emitted after each change. */
    readonly drafts: Stream.Stream<MessageDraftsList>;
    readonly list: Effect.Effect<MessageDraftsList>;
    readonly save: (input: MessageDraftSaveInput) => Effect.Effect<MessageDraft, MessageDraftError>;
    /** Removes the draft and returns it, so only one device can open it. */
    readonly take: (draftId: MessageDraftId) => Effect.Effect<MessageDraft, MessageDraftError>;
    readonly delete: (draftId: MessageDraftId) => Effect.Effect<void, MessageDraftError>;
    readonly send: (
      input: MessageDraftSendInput,
      sender: MessageDraftSender,
    ) => Effect.Effect<MessageDraftSendResult, MessageDraftError>;
  }
>()("t3/messageDrafts/MessageDrafts") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  // Attachment claims and sends read these per call.
  const services = yield* Effect.context<
    ThreadManagement.ThreadManagementService | ServerConfig.ServerConfig | FileSystem.FileSystem
  >();

  // A row that no longer decodes is skipped rather than failing every subscriber.
  const decodeRows = (rows: ReadonlyArray<unknown>) =>
    Effect.forEach(rows, (row) =>
      decodeRow(row).pipe(
        Effect.map(fromRow),
        Effect.map((draft) => [draft]),
        Effect.catch((cause) =>
          Effect.logWarning("Skipping a message draft that does not decode", cause).pipe(
            Effect.as([]),
          ),
        ),
      ),
    ).pipe(Effect.map((drafts) => drafts.flat()));

  const read = sql`
    SELECT draft_id AS "id", thread_id AS "threadId", text, attachments_json AS "attachments",
      context_json AS "context", origin, created_at AS "createdAt"
    FROM fork_message_drafts
    ORDER BY created_at DESC, rowid DESC
  `.pipe(Effect.flatMap(decodeRows));

  const state = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((drafts) => SubscriptionRef.set(state, drafts)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read message drafts", cause)),
  );

  const insert = Effect.fn("MessageDrafts.insert")(function* (draft: MessageDraft) {
    const row = yield* encodeRow({ ...draft, context: draft.context ?? null });
    yield* sql`
      INSERT INTO fork_message_drafts
        (draft_id, thread_id, text, attachments_json, context_json, origin, created_at)
      VALUES (${row.id}, ${row.threadId}, ${row.text}, ${row.attachments}, ${row.context},
        ${row.origin}, ${row.createdAt})
    `;
  });

  const liveThread = Effect.fn("MessageDrafts.liveThread")(function* (threadId: ThreadId) {
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(storageError));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new MessageDraftError({
        reason: "thread-not-found",
        detail: "The draft's thread no longer exists.",
      });
    }
    return thread;
  });

  /**
   * Attachments the thread already owns pass through: a queued message's, or a
   * draft's that was opened again. Ids minted for the thread name it; others
   * must appear on one of its messages, as for MCP sends.
   */
  const assertOwnedAttachments = Effect.fn("MessageDrafts.assertOwnedAttachments")(function* (
    threadId: ThreadId,
    projectId: ProjectId,
    attachments: ReadonlyArray<ChatAttachment>,
  ) {
    const segment = toSafeThreadAttachmentSegment(threadId);
    const unmatched = attachments.filter(
      (attachment) =>
        !AttachmentClaims.attachmentIsPendingUpload(attachment) &&
        parseThreadSegmentFromAttachmentId(attachment.id) !== segment,
    );
    if (unmatched.length === 0) return;
    const records = yield* threads
      .getProjectThreadRecords({ projectId, threadId }, ["messages"])
      .pipe(Effect.mapError(storageError));
    const owned = new Set(
      records.messages.flatMap((message) => message.attachments.map((item) => item.id)),
    );
    if (unmatched.some((attachment) => !owned.has(attachment.id))) {
      return yield* new MessageDraftError({
        reason: "invalid-attachment",
        detail: "Attachments must be new uploads or already belong to this thread.",
      });
    }
  });

  const save = Effect.fn("MessageDrafts.save")(function* (input: MessageDraftSaveInput) {
    if (input.text.trim().length === 0 && input.attachments.length === 0) {
      return yield* new MessageDraftError({ reason: "empty", detail: "The draft is empty." });
    }
    const thread = yield* liveThread(input.threadId);
    yield* assertOwnedAttachments(thread.id, thread.projectId, input.attachments);
    // Claiming copies each pending upload into the thread, out of reach of the
    // 24-hour pending sweep, so the draft can wait as long as the user likes.
    const claimed = yield* AttachmentClaims.claimPendingAttachments({
      threadId: thread.id,
      attachments: input.attachments,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new MessageDraftError({ reason: "invalid-attachment", detail: cause.message, cause }),
      ),
    );
    const uuid = yield* crypto.randomUUIDv4().pipe(Effect.mapError(storageError));
    const remappedContext = remapComposerContextAttachments(
      input.context,
      input.attachments,
      claimed.attachments,
    );
    const draft: MessageDraft = {
      id: MessageDraftId.make(`draft_${uuid}`),
      threadId: thread.id,
      text: input.text,
      attachments: claimed.attachments,
      ...(remappedContext === undefined ? {} : { context: remappedContext }),
      origin: input.origin,
      createdAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* insert(draft).pipe(
      Effect.mapError(storageError),
      Effect.tapError(() => AttachmentClaims.releaseClaimedAttachments(claimed.claimedPaths)),
    );
    yield* refresh;
    return draft;
  }, Effect.provide(services));

  const take = Effect.fn("MessageDrafts.take")(function* (draftId: MessageDraftId) {
    // One statement, so two devices opening the same draft cannot both get it.
    const rows = yield* sql`
      DELETE FROM fork_message_drafts WHERE draft_id = ${draftId}
      RETURNING draft_id AS "id", thread_id AS "threadId", text,
        attachments_json AS "attachments", context_json AS "context", origin,
        created_at AS "createdAt"
    `.pipe(Effect.mapError(storageError));
    if (rows.length === 0) return yield* notFound();
    yield* refresh;
    return fromRow(yield* decodeRow(rows[0]).pipe(Effect.mapError(storageError)));
  });

  // Attachment files stay: their ids can be shared with the queued message the
  // draft came from, or with a message sent after the draft was opened.
  const deleteDraft = Effect.fn("MessageDrafts.delete")(function* (draftId: MessageDraftId) {
    const rows = yield* sql`
      DELETE FROM fork_message_drafts WHERE draft_id = ${draftId} RETURNING draft_id
    `.pipe(Effect.mapError(storageError));
    if (rows.length === 0) return yield* notFound();
    yield* refresh;
  });

  const restore = (draft: MessageDraft) =>
    insert(draft).pipe(
      Effect.andThen(refresh),
      Effect.catch((cause) => Effect.logWarning("Could not restore an unsent draft", cause)),
      Effect.uninterruptible,
    );

  const send = Effect.fn("MessageDrafts.send")(function* (
    input: MessageDraftSendInput,
    sender: MessageDraftSender,
  ) {
    const draft = yield* take(input.draftId);
    return yield* Effect.gen(function* () {
      const thread = yield* liveThread(draft.threadId);
      const uuid = yield* crypto.randomUUIDv4().pipe(Effect.mapError(storageError));
      const messageId = MessageId.make(`message:draft:${uuid}`);
      yield* ThreadMessageIntake.sendToThread({
        projectId: thread.projectId,
        threadId: thread.id,
        commandId: CommandId.make(`message-draft:send:${uuid}`),
        messageId,
        ...(sender.senderThreadId === undefined ? {} : { senderThreadId: sender.senderThreadId }),
        text: draft.text,
        ...(draft.context === undefined ? {} : { context: draft.context }),
        attachments: draft.attachments,
        mode: input.mode,
        createdBy: sender.createdBy,
        creationSource: sender.creationSource,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new MessageDraftError({
              reason: "send-failed",
              detail:
                isThreadManagementError(cause) || isAttachmentClaimError(cause)
                  ? cause.message
                  : "The draft could not be sent.",
              cause,
            }),
        ),
      );
      return { threadId: thread.id, messageId } satisfies MessageDraftSendResult;
    }).pipe(Effect.onError(() => restore(draft)));
  }, Effect.provide(services));

  return MessageDrafts.of({
    drafts: SubscriptionRef.changes(state),
    list: SubscriptionRef.get(state),
    save,
    take,
    delete: deleteDraft,
    send,
  });
});

export const layer = Layer.effect(MessageDrafts, make);
