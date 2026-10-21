import { MessageDraft, MessageDraftId, MessageDraftSendResult } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { projectLocationFlags } from "./config.ts";
import {
  decodeThreadId,
  jsonFlag,
  messageArgument,
  printJson,
  readMessageArgument,
  reportThreadErrors,
  threadArgument,
  ThreadUsageError,
  withThreadTools,
} from "./thread.ts";

const decodeDraftIdValue = Schema.decodeUnknownEffect(MessageDraftId);
const decodeDraftId = (value: string) =>
  decodeDraftIdValue(value.trim()).pipe(
    Effect.mapError(() => new ThreadUsageError({ detail: `'${value}' is not a draft id.` })),
  );
const draftArgument = Argument.String("draft").pipe(Argument.withDescription("Draft id."));

const draftListCommand = Command.make("list", {
  ...projectLocationFlags,
  thread: Flag.String("thread").pipe(
    Flag.withDescription("Only this thread's drafts. Defaults to every thread."),
    Flag.optional,
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("List message drafts, newest first."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = Option.isSome(flags.thread)
        ? yield* decodeThreadId(flags.thread.value)
        : undefined;
      yield* withThreadTools(
        flags,
        Effect.fn("cli.draft.list")(function* (tools) {
          const { drafts } = yield* tools.call(
            "t3_draft_list",
            threadId === undefined ? {} : { threadId },
            Schema.Struct({ drafts: Schema.Array(MessageDraft) }),
          );
          if (flags.json) return yield* printJson(drafts);
          if (drafts.length === 0) return yield* Console.log("No drafts.");
          for (const draft of drafts) {
            const firstLine = draft.text.trim().split("\n")[0] ?? "";
            yield* Console.log(`${draft.id}  ${draft.threadId}  ${firstLine}`);
          }
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const draftCreateCommand = Command.make("create", {
  ...projectLocationFlags,
  thread: threadArgument,
  message: messageArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Save a message as a draft in a thread, to review and send later from any client. Prints its id.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const text = yield* readMessageArgument(flags.message);
      yield* withThreadTools(
        flags,
        Effect.fn("cli.draft.create")(function* (tools) {
          const draft = yield* tools.call("t3_draft_create", { threadId, text }, MessageDraft);
          yield* flags.json ? printJson(draft) : Console.log(draft.id);
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const draftSendCommand = Command.make("send", {
  ...projectLocationFlags,
  thread: threadArgument,
  draft: draftArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Send a draft to its thread and remove it. A busy thread gets it as its next turn.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const draftId = yield* decodeDraftId(flags.draft);
      yield* withThreadTools(
        flags,
        Effect.fn("cli.draft.send")(function* (tools) {
          const sent = yield* tools.call(
            "t3_draft_send",
            { threadId, draftId, mode: "queue" },
            MessageDraftSendResult,
          );
          yield* flags.json ? printJson(sent) : Console.log("Sent.");
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const draftDeleteCommand = Command.make("delete", {
  ...projectLocationFlags,
  thread: threadArgument,
  draft: draftArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Delete a draft without sending it."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const draftId = yield* decodeDraftId(flags.draft);
      yield* withThreadTools(
        flags,
        Effect.fn("cli.draft.delete")(function* (tools) {
          yield* tools.call("t3_draft_delete", { threadId, draftId }, Schema.Unknown);
          yield* flags.json ? printJson({ draftId, deleted: true }) : Console.log("Deleted.");
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

export const draftCommand = Command.make("draft").pipe(
  Command.withDescription("Save, list, send, and delete message drafts on the running server."),
  Command.withSubcommands([
    draftListCommand,
    draftCreateCommand,
    draftSendCommand,
    draftDeleteCommand,
  ]),
);
