// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type ChatAttachment,
  ChatAttachmentId,
  ComposerContextId,
  type MessageDrafts as MessageDraftsList,
  MessageDraftId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPath,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import * as MessageDrafts from "./MessageDrafts.ts";
import { ensureMessageDraftsSchema } from "./schema.ts";

const THREAD_ID = ThreadId.make("draft-thread");
const OTHER_THREAD_ID = ThreadId.make("other-thread");

const sent: Array<ThreadManagement.ThreadManagementSendInput> = [];

const threadsLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
  getThreadShell: (threadId) =>
    Effect.succeed(
      threadId === THREAD_ID || threadId === OTHER_THREAD_ID ? liveThreadShell(threadId) : null,
    ),
  // No thread messages, so only ids minted for the thread count as owned.
  getProjectThreadRecords: () => Effect.succeed({ messages: [] } as never),
  sendToThread: (input) =>
    input.text === "fail"
      ? Effect.fail(
          new ThreadManagement.ThreadManagementThreadArchivedError({ threadId: input.threadId }),
        )
      : Effect.sync(() => {
          sent.push(input);
          return {
            message: { attachments: input.attachments },
          } as unknown as ThreadManagement.ThreadManagementSendResult;
        }),
});

const testLayer = MessageDrafts.layer.pipe(
  Layer.provideMerge(threadsLayer),
  Layer.provideMerge(
    Layer.effectDiscard(
      Effect.gen(function* () {
        yield* runMigrations();
        yield* ensureThreadTabsSchema();
        yield* ensureMessageDraftsSchema();
      }),
    ),
  ),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-message-drafts-" })),
  Layer.provideMerge(NodeServices.layer),
);

const stagePendingUpload = Effect.fn("test.stagePendingUpload")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const pendingId = createPendingAttachmentId(".png");
  const bytes = new Uint8Array([1, 2, 3]);
  yield* Effect.sync(() => {
    NodeFS.mkdirSync(config.attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`), bytes);
  });
  return {
    type: "image",
    id: ChatAttachmentId.make(pendingId),
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: bytes.byteLength,
  } satisfies ChatAttachment;
});

const imageRecord = (attachmentId: string) => ({
  version: 1 as const,
  kind: "image" as const,
  contextId: ComposerContextId.make("context-image"),
  label: "shot.png",
  attachmentId,
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 3,
});

it.layer(testLayer)("MessageDrafts", (it) => {
  it.effect("claims a pending upload into the thread and remaps its context", () =>
    Effect.gen(function* () {
      const drafts = yield* MessageDrafts.MessageDrafts;
      const config = yield* ServerConfig.ServerConfig;
      const pending = yield* stagePendingUpload();
      const draft = yield* drafts.save({
        threadId: THREAD_ID,
        text: "look at this",
        attachments: [pending],
        context: { version: 1, records: [imageRecord(pending.id)] },
        origin: "web",
      });
      const [claimed] = draft.attachments;
      assert.isDefined(claimed);
      assert.strictEqual(
        parseThreadSegmentFromAttachmentId(claimed!.id),
        toSafeThreadAttachmentSegment(THREAD_ID),
      );
      const claimedPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment: claimed!,
      });
      assert.isTrue(claimedPath !== null && NodeFS.existsSync(claimedPath));
      assert.deepEqual(draft.context?.records, [imageRecord(claimed!.id)]);
      assert.isTrue(draft.id.startsWith("draft_"));

      // Saving the opened draft again keeps the attachment the thread now owns.
      const taken = yield* drafts.take(draft.id);
      const resaved = yield* drafts.save({ ...taken, origin: "mobile" });
      assert.deepEqual(resaved.attachments, draft.attachments);
      yield* drafts.delete(resaved.id);
    }),
  );

  it.effect("rejects empty drafts, unknown threads, and another thread's attachments", () =>
    Effect.gen(function* () {
      const drafts = yield* MessageDrafts.MessageDrafts;
      const empty = yield* drafts
        .save({ threadId: THREAD_ID, text: "  ", attachments: [], origin: "web" })
        .pipe(Effect.flip);
      assert.strictEqual(empty.reason, "empty");
      const missing = yield* drafts
        .save({ threadId: ThreadId.make("gone"), text: "hi", attachments: [], origin: "web" })
        .pipe(Effect.flip);
      assert.strictEqual(missing.reason, "thread-not-found");
      const foreign = yield* drafts
        .save({
          threadId: THREAD_ID,
          text: "hi",
          attachments: [
            {
              type: "file",
              id: ChatAttachmentId.make("other-thread-00000000-0000-4000-8000-000000000000-txt"),
              name: "a.txt",
              mimeType: "text/plain",
              sizeBytes: 1,
            },
          ],
          origin: "web",
        })
        .pipe(Effect.flip);
      assert.strictEqual(foreign.reason, "invalid-attachment");
      assert.deepEqual(yield* drafts.list, []);
    }),
  );

  it.effect("lets only one take open a draft, and delete reports a missing draft", () =>
    Effect.gen(function* () {
      const drafts = yield* MessageDrafts.MessageDrafts;
      const draft = yield* drafts.save({
        threadId: THREAD_ID,
        text: "later",
        attachments: [],
        origin: "desktop",
      });
      const taken = yield* drafts.take(draft.id);
      assert.deepEqual(taken, draft);
      assert.strictEqual((yield* drafts.take(draft.id).pipe(Effect.flip)).reason, "not-found");
      assert.strictEqual((yield* drafts.delete(draft.id).pipe(Effect.flip)).reason, "not-found");
      const missing = yield* drafts.delete(MessageDraftId.make("draft_missing")).pipe(Effect.flip);
      assert.strictEqual(missing.reason, "not-found");
    }),
  );

  it.effect("sends a draft and removes it, and restores it when sending fails", () =>
    Effect.gen(function* () {
      const drafts = yield* MessageDrafts.MessageDrafts;
      const draft = yield* drafts.save({
        threadId: THREAD_ID,
        text: "ship it",
        attachments: [],
        origin: "web",
      });
      const result = yield* drafts.send(
        { draftId: draft.id, mode: "queue" },
        { createdBy: "user", creationSource: "web" },
      );
      assert.strictEqual(result.threadId, THREAD_ID);
      const dispatched = sent.at(-1);
      assert.strictEqual(dispatched?.text, "ship it");
      assert.strictEqual(dispatched?.mode, "queue");
      assert.strictEqual(dispatched?.messageId, result.messageId);
      assert.strictEqual(dispatched?.projectId, liveThreadShell(THREAD_ID).projectId);
      assert.deepEqual(yield* drafts.list, []);

      const failing = yield* drafts.save({
        threadId: THREAD_ID,
        text: "fail",
        attachments: [],
        origin: "web",
      });
      const error = yield* drafts
        .send({ draftId: failing.id, mode: "auto" }, { createdBy: "user", creationSource: "web" })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "send-failed");
      assert.deepEqual(yield* drafts.list, [failing]);
      yield* drafts.delete(failing.id);
    }),
  );

  it.effect("streams the full list, newest first, after each change", () =>
    Effect.gen(function* () {
      const drafts = yield* MessageDrafts.MessageDrafts;
      const subscribed = yield* Deferred.make<void>();
      const fiber = yield* drafts.drafts.pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      const first = yield* drafts.save({
        threadId: THREAD_ID,
        text: "first",
        attachments: [],
        origin: "web",
      });
      const second = yield* drafts.save({
        threadId: OTHER_THREAD_ID,
        text: "second",
        attachments: [],
        origin: "agent",
      });
      const emitted: ReadonlyArray<MessageDraftsList> = yield* Fiber.join(fiber);
      assert.deepEqual(
        emitted.map((list) => list.map((draft) => draft.id)),
        [[], [first.id], [second.id, first.id]],
      );
      yield* drafts.delete(first.id);
      yield* drafts.delete(second.id);
    }),
  );
});
