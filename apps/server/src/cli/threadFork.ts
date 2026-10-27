/**
 * The fork's `t3 thread` subcommands, kept out of upstream's `thread.ts` so
 * upstream syncs touch as little of it as possible.
 */
import {
  OrchestrationSearchThreadsResult,
  OrchestratorMcpThreadInterruptResult,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadRollbackResult,
  OrchestratorMcpThreadUsageLimitResumeResult,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestratorMcpThreadDetail,
  type OrchestratorMcpThreadTimelineItem,
} from "@t3tools/contracts";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { OPERATE_MCP_PATH } from "../mcp/paths.ts";
import { projectLocationFlags } from "./config.ts";
import {
  decodeThreadId,
  decodeTitle,
  finishRun,
  jsonFlag,
  listAllProjects,
  printJson,
  readFullText,
  readTimeline,
  reportThreadErrors,
  resolveProject,
  threadArgument,
  threadListCommand,
  threadSendCommand,
  threadShowCommand,
  threadStartCommand,
  ThreadUsageError,
  waitFlag,
  withThreadTools,
} from "./thread.ts";

const yesFlag = Flag.Boolean("yes").pipe(
  Flag.withDescription("Confirm an action that cannot be undone."),
  Flag.withDefault(false),
);

/** Commands that act on one thread and print a short confirmation, or the tool's result with --json. */
const threadActionCommand = <S extends Schema.Decoder<unknown>>(input: {
  readonly name: string;
  readonly description: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: S;
  readonly done: (result: S["Type"]) => string;
  readonly path?: typeof OPERATE_MCP_PATH;
}) =>
  Command.make(input.name, {
    ...projectLocationFlags,
    thread: threadArgument,
    json: jsonFlag,
  }).pipe(
    Command.withDescription(input.description),
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const threadId = yield* decodeThreadId(flags.thread);
        yield* withThreadTools(
          flags,
          Effect.fn("cli.thread.action")(function* (tools) {
            const result = yield* tools.call(input.tool, { ...input.args, threadId }, input.result);
            yield* flags.json ? printJson(result) : Console.log(input.done(result));
          }),
          input.path,
        );
      }).pipe(reportThreadErrors),
    ),
  );

const organizeCommand = (name: string, done: string, description: string) =>
  threadActionCommand({
    name,
    description,
    tool: "t3_thread_organize",
    args: { action: name },
    result: Schema.Unknown,
    done: () => done,
  });

const threadStopCommand = threadActionCommand({
  name: "stop",
  description: "Interrupt a thread's running turn.",
  tool: "t3_thread_interrupt",
  args: {},
  result: OrchestratorMcpThreadInterruptResult,
  done: (result) =>
    result.status === "interrupt_requested"
      ? "Stopping."
      : result.status === "no_active_run"
        ? "Nothing is running."
        : `The run already ended: ${result.status}.`,
});

const threadSearchCommand = Command.make("search", {
  ...projectLocationFlags,
  query: Argument.String("query").pipe(
    Argument.withDescription("Words to find in thread titles and messages."),
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription(
      "Only this project: an id or a path inside it. Defaults to every project.",
    ),
    Flag.optional,
  ),
  limit: Flag.Int("limit").pipe(
    Flag.withDescription("Most matches to return, up to 50."),
    Flag.withDefault(20),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Search thread titles and messages."),
  Command.withHandler((flags) =>
    withThreadTools(
      flags,
      Effect.fn("cli.thread.search")(function* (tools) {
        const projectId = Option.isSome(flags.project)
          ? (yield* resolveProject(tools, flags.project.value)).id
          : undefined;
        const { matches } = yield* tools.call(
          "t3_thread_search",
          {
            query: flags.query,
            limit: flags.limit,
            ...(projectId === undefined ? {} : { projectId }),
          },
          OrchestrationSearchThreadsResult,
        );
        if (flags.json) return yield* printJson(matches);
        for (const match of matches) {
          yield* Console.log(
            `${match.threadId}  ${match.source.padEnd(9)}  ${match.snippet.replace(/\s+/g, " ").trim()}`,
          );
        }
      }),
    ).pipe(reportThreadErrors),
  ),
);

const threadRenameCommand = Command.make("rename", {
  ...projectLocationFlags,
  thread: threadArgument,
  title: Argument.String("title").pipe(Argument.withDescription("The new title.")),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Rename a thread."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const title = yield* decodeTitle(flags.title).pipe(
        Effect.mapError(() => new ThreadUsageError({ detail: "The title is empty." })),
      );
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.rename")(function* (tools) {
          const result = yield* tools.call(
            "t3_thread_update",
            { threadId, action: "rename", title },
            Schema.Unknown,
          );
          yield* flags.json ? printJson(result) : Console.log("Renamed.");
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadResumeCommand = Command.make("resume", {
  ...projectLocationFlags,
  thread: threadArgument,
  wait: waitFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Resume a thread stopped on a provider usage limit now, like Resume now in the app.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.resume")(function* (tools) {
          const resumed = yield* tools.call(
            "t3_thread_usage_limit_resume",
            { threadId },
            OrchestratorMcpThreadUsageLimitResumeResult,
          );
          if (flags.wait) {
            return yield* finishRun(tools, { threadId, runId: resumed.runId, json: flags.json });
          }
          yield* flags.json ? printJson(resumed) : Console.log("Resumed.");
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadForkCommand = Command.make("fork", {
  ...projectLocationFlags,
  thread: threadArgument,
  run: Flag.String("run").pipe(
    Flag.withDescription("Fork from this run id. Defaults to the latest stable point."),
    Flag.optional,
  ),
  title: Flag.String("title").pipe(Flag.withDescription("Title for the fork."), Flag.optional),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Fork a thread into a new one and print the new thread's id."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const title = Option.isSome(flags.title)
        ? yield* decodeTitle(flags.title.value).pipe(
            Effect.mapError(() => new ThreadUsageError({ detail: "The title is empty." })),
          )
        : undefined;
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.fork")(function* (tools) {
          const forked = yield* tools.call(
            "t3_thread_transfer",
            {
              action: "fork",
              threadId,
              sourcePoint: Option.match(flags.run, {
                onNone: () => ({ type: "latest_stable" }),
                onSome: (runId) => ({ type: "run", runId }),
              }),
              ...(title === undefined ? {} : { title }),
            },
            Schema.Struct({ targetThreadId: ThreadId }),
          );
          yield* flags.json ? printJson(forked) : Console.log(forked.targetThreadId);
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadMoveCommand = Command.make("move", {
  ...projectLocationFlags,
  thread: threadArgument,
  project: Argument.String("project").pipe(
    Argument.withDescription("Destination project id or a path inside it."),
  ),
  pr: Flag.String("pr").pipe(
    Flag.withDescription("Land on this pull request's branch (URL or number) in a worktree."),
    Flag.optional,
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Move a thread to another project, keeping its conversation."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.move")(function* (tools) {
          const project = yield* resolveProject(tools, flags.project);
          const moved = yield* tools.call(
            "t3_thread_move",
            {
              threadId,
              projectId: project.id,
              ...Option.match(flags.pr, {
                onNone: () => ({}),
                onSome: (reference) => ({
                  workspaceStrategy: { type: "pull_request", reference },
                }),
              }),
            },
            Schema.Struct({ worktreePath: Schema.NullOr(Schema.String) }),
          );
          yield* flags.json
            ? printJson(moved)
            : Console.log(
                `Moved to ${project.title}${moved.worktreePath === null ? "" : ` (${moved.worktreePath})`}.`,
              );
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadRollbackCommand = Command.make("rollback", {
  ...projectLocationFlags,
  thread: threadArgument,
  run: Argument.Int("run").pipe(
    Argument.withDescription(
      "Keep runs up to this ordinal (the run number `t3 thread show --json` lists); 0 discards every run.",
    ),
  ),
  keepFiles: Flag.Boolean("keep-files").pipe(
    Flag.withDescription("Rewind only the conversation and leave the workspace files as they are."),
    Flag.withDefault(false),
  ),
  yes: yesFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Roll a thread back to the checkpoint after one of its runs, discarding later runs.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      if (!flags.yes) {
        return yield* new ThreadUsageError({
          detail: "A rollback discards later runs and cannot be undone. Pass --yes to confirm.",
        });
      }
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.rollback")(function* (tools) {
          const result = yield* tools.call(
            "t3_thread_rollback",
            { threadId, runOrdinal: flags.run, restoreFiles: !flags.keepFiles },
            OrchestratorMcpThreadRollbackResult,
          );
          yield* flags.json ? printJson(result) : Console.log("Rolling back.");
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadDeleteCommand = Command.make("delete", {
  ...projectLocationFlags,
  thread: threadArgument,
  yes: yesFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Delete a thread for good. Running work stops. `t3 thread archive` can be undone instead.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      if (!flags.yes) {
        return yield* new ThreadUsageError({
          detail: "Deleting a thread cannot be undone. Pass --yes to confirm.",
        });
      }
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.delete")(function* (tools) {
          const result = yield* tools.call("t3_thread_delete", { threadId }, Schema.Unknown);
          yield* flags.json ? printJson(result) : Console.log("Deleted.");
        }),
        OPERATE_MCP_PATH,
      );
    }).pipe(reportThreadErrors),
  ),
);

const PendingApprovals = Schema.Struct({
  pendingApprovals: Schema.Array(
    Schema.Struct({
      requestId: RuntimeRequestId,
      turnId: Schema.NullOr(Schema.String),
      kind: Schema.String,
      prompt: Schema.NullOr(Schema.String),
    }),
  ),
});

const PendingQuestion = Schema.Struct({
  requestId: RuntimeRequestId,
  questions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      header: Schema.String,
      question: Schema.String,
      options: Schema.Array(
        Schema.Struct({
          label: Schema.String,
          description: Schema.String,
          value: Schema.optional(Schema.String),
        }),
      ),
      multiSelect: Schema.optional(Schema.Boolean),
      allowCustomAnswer: Schema.optional(Schema.Boolean),
    }),
  ),
});
type PendingQuestion = typeof PendingQuestion.Type;

/**
 * One `--answer` per question, in order. An answer naming an option (its
 * number, label, or value) picks it; a multi-select takes a comma-separated
 * list of options; anything else is a free-text answer where allowed.
 */
export const pendingAnswers = Effect.fn("cli.thread.pendingAnswers")(function* (
  questions: PendingQuestion["questions"],
  answers: ReadonlyArray<string>,
) {
  if (answers.length !== questions.length) {
    return yield* new ThreadUsageError({
      detail: `This request asks ${questions.length} question(s); pass --answer once for each, in order.`,
    });
  }
  const result: Record<string, string | ReadonlyArray<string>> = {};
  for (const [index, question] of questions.entries()) {
    const answer = answers[index]!.trim();
    const optionValue = (part: string) => {
      const byNumber = /^\d+$/u.test(part) ? question.options[Number(part) - 1] : undefined;
      const option =
        byNumber ??
        question.options.find(
          (candidate) =>
            candidate.value === part || candidate.label.toLowerCase() === part.toLowerCase(),
        );
      return option === undefined ? undefined : (option.value ?? option.label);
    };
    const picked = question.multiSelect
      ? answer.split(",").map((part) => optionValue(part.trim()))
      : [optionValue(answer)];
    if (picked.every((value) => value !== undefined)) {
      result[question.id] = question.multiSelect ? picked : picked[0]!;
    } else if (question.allowCustomAnswer === false || answer.length === 0) {
      return yield* new ThreadUsageError({
        detail: `'${answer}' is not an option for "${question.question}". Choose from: ${question.options.map((option, optionIndex) => `${optionIndex + 1}) ${option.label}`).join(", ")}.`,
      });
    } else {
      result[question.id] = answer;
    }
  }
  return result;
});

const threadAnswerCommand = Command.make("answer", {
  ...projectLocationFlags,
  thread: threadArgument,
  approve: Flag.Boolean("approve").pipe(
    Flag.withDescription("Approve the pending permission request."),
    Flag.withDefault(false),
  ),
  deny: Flag.Boolean("deny").pipe(
    Flag.withDescription("Decline the pending permission request."),
    Flag.withDefault(false),
  ),
  answer: Flag.String("answer").pipe(
    Flag.withDescription(
      "Answer the pending question: an option's number or label, or your own text. Repeat once per question.",
    ),
    Flag.atLeast(0),
  ),
  request: Flag.String("request").pipe(
    Flag.withDescription("Request id to answer. Defaults to the oldest pending one."),
    Flag.optional,
  ),
  wait: waitFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Answer what a thread is waiting on. Without --approve, --deny, or --answer, print it.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const actions = [flags.approve, flags.deny, flags.answer.length > 0].filter(Boolean).length;
      if (actions > 1) {
        return yield* new ThreadUsageError({
          detail: "Pass one of --approve, --deny, or --answer.",
        });
      }
      const matchesRequest = (requestId: string) =>
        Option.match(flags.request, { onNone: () => true, onSome: (id) => id === requestId });
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.answer")(function* (tools) {
          const { pendingApprovals } = yield* tools.call(
            "get_thread",
            { threadId },
            PendingApprovals,
          );
          const { requestIds } = yield* tools.call(
            "t3_pending_request",
            { action: "list", threadId },
            Schema.Struct({ requestIds: Schema.Array(RuntimeRequestId) }),
          );
          const questions = yield* Effect.forEach(requestIds, (requestId) =>
            tools.call(
              "t3_pending_request",
              { action: "read", threadId, requestId },
              PendingQuestion,
            ),
          );

          let runId: string | null = null;
          if (flags.approve || flags.deny) {
            const approval = pendingApprovals.find((entry) => matchesRequest(entry.requestId));
            if (approval === undefined) {
              return yield* new ThreadUsageError({
                detail: `Thread ${threadId} has no pending approval${Option.isSome(flags.request) ? ` ${flags.request.value}` : ""}.`,
              });
            }
            const result = yield* tools.call(
              "t3_approval_respond",
              {
                threadId,
                requestId: approval.requestId,
                decision: flags.approve ? "accept" : "decline",
              },
              Schema.Unknown,
            );
            if (!flags.wait) {
              return yield* flags.json
                ? printJson(result)
                : Console.log(flags.approve ? "Approved." : "Declined.");
            }
            runId = approval.turnId;
          } else if (flags.answer.length > 0) {
            const pending = questions.find((entry) => matchesRequest(entry.requestId));
            if (pending === undefined) {
              return yield* new ThreadUsageError({
                detail: `Thread ${threadId} has no pending question${Option.isSome(flags.request) ? ` ${flags.request.value}` : ""}.`,
              });
            }
            const answers = yield* pendingAnswers(pending.questions, flags.answer);
            const result = yield* tools.call(
              "t3_pending_request",
              { action: "respond", threadId, requestId: pending.requestId, answers },
              Schema.Unknown,
            );
            if (!flags.wait) {
              return yield* flags.json ? printJson(result) : Console.log("Answered.");
            }
          } else {
            if (flags.json) {
              return yield* printJson({ approvals: pendingApprovals, questions });
            }
            if (pendingApprovals.length === 0 && questions.length === 0) {
              return yield* Console.log("Nothing is waiting for an answer.");
            }
            for (const approval of pendingApprovals) {
              yield* Console.log(`${approval.requestId}  approval (${approval.kind})`);
              if (approval.prompt !== null) yield* Console.log(`  ${approval.prompt}`);
              yield* Console.log("  Answer with --approve or --deny.");
            }
            for (const pending of questions) {
              yield* Console.log(`${pending.requestId}  question`);
              for (const question of pending.questions) {
                yield* Console.log(`  ${question.header}: ${question.question}`);
                for (const [index, option] of question.options.entries()) {
                  yield* Console.log(
                    `    ${index + 1}) ${option.label}${option.description ? `: ${option.description}` : ""}`,
                  );
                }
              }
              yield* Console.log(
                pending.questions.length === 1
                  ? "  Answer with --answer <option or text>."
                  : `  Answer with --answer once per question (${pending.questions.length}), in order.`,
              );
            }
            return;
          }

          const { thread } = yield* tools.call(
            "t3_thread_read",
            { threadId, limit: 1, runLimit: 1 },
            OrchestratorMcpThreadReadResult,
          );
          const waitRunId = runId ?? thread.activeRunId ?? thread.latestRunId;
          if (waitRunId === null) return;
          return yield* finishRun(tools, {
            threadId,
            runId: RunId.make(waitRunId),
            json: flags.json,
          });
        }),
        OPERATE_MCP_PATH,
      );
    }).pipe(reportThreadErrors),
  ),
);

/** Inline code that survives backticks inside the value. */
const inlineCode = (value: string) => {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.includes("`") ? `\`\` ${singleLine} \`\`` : `\`${singleLine}\``;
};

const workLine = (item: Pick<OrchestratorMcpThreadTimelineItem, "type" | "title" | "text">) => {
  const toolName =
    item.type === "dynamic_tool"
      ? /"toolName":\s*"([^"]+)"/u.exec(item.text ?? "")?.[1]
      : undefined;
  const label = item.title ?? toolName ?? item.type.replaceAll("_", " ");
  const firstLine = (item.text ?? "").split("\n")[0]?.trim() ?? "";
  if (item.type === "command_execution" && firstLine.startsWith("$ ")) {
    return `- **${label}** ${inlineCode(firstLine.slice(2))}`;
  }
  if (item.type === "file_change" && firstLine.length > 0) {
    return `- **${label}**: ${inlineCode(firstLine)}`;
  }
  const single = item.text !== null && !item.text.includes("\n") && item.text.length <= 200;
  return single && item.text !== label ? `- **${label}**: ${item.text}` : `- **${label}**`;
};

export interface TranscriptEntry {
  readonly type: string;
  readonly title: string | null;
  /** Full text for messages and plans; work items only need their first line. */
  readonly text: string | null;
}

/**
 * The web's "Export transcript" layout, built from `t3_thread_read`'s timeline
 * since the web builder needs the client's full thread projection. Reasoning is
 * always left out; `full` interleaves work and proposed plans.
 */
export const formatTranscript = (input: {
  readonly thread: Pick<
    OrchestratorMcpThreadDetail,
    "title" | "branch" | "providerInstanceId" | "model" | "createdAt"
  >;
  readonly projectTitle: string | null;
  readonly entries: ReadonlyArray<TranscriptEntry>;
  readonly full: boolean;
  readonly header: boolean;
  readonly exportedAt: string;
}) => {
  const blocks: Array<string> = [];
  if (input.header) {
    const { thread } = input;
    blocks.push(
      [
        "---",
        `thread: ${JSON.stringify(thread.title)}`,
        ...(input.projectTitle ? [`project: ${JSON.stringify(input.projectTitle)}`] : []),
        ...(thread.branch ? [`branch: ${JSON.stringify(thread.branch)}`] : []),
        `provider: ${JSON.stringify(thread.providerInstanceId)}`,
        `model: ${JSON.stringify(thread.model)}`,
        `created: ${thread.createdAt}`,
        `exported: ${input.exportedAt}`,
        "---",
      ].join("\n"),
    );
  }
  blocks.push(`# ${input.thread.title}`);
  let speaker: "user" | "assistant" | null = null;
  let work: Array<string> = [];
  const flushWork = () => {
    if (work.length > 0) blocks.push(work.join("\n"));
    work = [];
  };
  for (const entry of input.entries) {
    const kind =
      entry.type === "user_message" || entry.type === "assistant_message"
        ? "message"
        : entry.type === "proposed_plan"
          ? "plan"
          : "work";
    if (!input.full && kind !== "message") continue;
    if (entry.type === "reasoning" || entry.type === "checkpoint") continue;
    const text =
      entry.type === "user_message"
        ? replaceComposerContextReferences(entry.text ?? "", (reference) =>
            reference.image ? `[image: ${reference.label}]` : reference.label,
          ).trim()
        : (entry.text ?? "").trim();
    if (kind !== "work" && text.length === 0) continue;
    const entrySpeaker = entry.type === "user_message" ? "user" : "assistant";
    if (entrySpeaker !== speaker) {
      flushWork();
      blocks.push(entrySpeaker === "user" ? "## User" : "## Assistant");
      speaker = entrySpeaker;
    }
    if (kind === "work") {
      work.push(workLine(entry));
      continue;
    }
    flushWork();
    blocks.push(kind === "plan" ? `### Plan\n\n${text}` : text);
  }
  flushWork();
  return `${blocks.join("\n\n")}\n`;
};

const threadExportCommand = Command.make("export", {
  ...projectLocationFlags,
  thread: threadArgument,
  full: Flag.Boolean("full").pipe(
    Flag.withDescription("Include the work log (commands, file edits, tool calls) and plans."),
    Flag.withDefault(false),
  ),
  header: Flag.Boolean("header").pipe(
    Flag.withDescription("Start with a YAML header: project, branch, model, dates."),
    Flag.withDefault(false),
  ),
  output: Flag.String("output").pipe(
    Flag.withAlias("o"),
    Flag.withDescription("Write to this file instead of stdout."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Print a thread's conversation as Markdown. Reasoning is left out."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      yield* withThreadTools(
        flags,
        Effect.fn("cli.thread.export")(function* (tools) {
          const { thread, items } = yield* readTimeline(
            tools,
            threadId,
            flags.full ? "activity" : "messages",
          );
          const entries: Array<TranscriptEntry> = [];
          for (const item of items) {
            const whole =
              item.type === "user_message" ||
              item.type === "assistant_message" ||
              item.type === "proposed_plan";
            entries.push(
              whole ? { ...item, text: yield* readFullText(tools, threadId, item) } : item,
            );
          }
          const projectTitle = flags.header
            ? ((yield* listAllProjects(tools)).find((project) => project.id === thread.projectId)
                ?.title ?? null)
            : null;
          const markdown = formatTranscript({
            thread,
            projectTitle,
            entries,
            full: flags.full,
            header: flags.header,
            exportedAt: DateTime.formatIso(yield* DateTime.now),
          });
          if (Option.isNone(flags.output)) return yield* Console.log(markdown.trimEnd());
          const fileSystem = yield* FileSystem.FileSystem;
          yield* fileSystem.writeFileString(flags.output.value, markdown).pipe(
            Effect.mapError(
              (cause) =>
                new ThreadUsageError({
                  detail: `Could not write ${flags.output.pipe(Option.getOrElse(() => ""))}: ${cause.message}`,
                }),
            ),
          );
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

export const forkThreadCommand = Command.make("thread").pipe(
  Command.withDescription("Start, message, and read threads on the running server."),
  Command.withSubcommands([
    threadListCommand,
    threadStartCommand,
    threadSendCommand,
    threadShowCommand,
    threadAnswerCommand,
    threadResumeCommand,
    threadStopCommand,
    threadSearchCommand,
    threadExportCommand,
    threadRenameCommand,
    threadForkCommand,
    threadMoveCommand,
    organizeCommand("archive", "Archived.", "Archive a thread. `t3 thread unarchive` restores it."),
    organizeCommand("unarchive", "Restored.", "Restore an archived thread."),
    organizeCommand("hide", "Hidden.", "Hide a thread from the sidebar."),
    organizeCommand("unhide", "Shown.", "Show a hidden thread in the sidebar again."),
    organizeCommand("settle", "Settled.", "Move a thread out of the active list."),
    organizeCommand("unsettle", "Unsettled.", "Return a settled thread to the active list."),
    threadRollbackCommand,
    threadDeleteCommand,
  ]),
);
