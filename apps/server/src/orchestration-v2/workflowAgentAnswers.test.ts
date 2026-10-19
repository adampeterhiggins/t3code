// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  emptyWorkflowAgentTranscriptCursor,
  parseWorkflowAgentTranscript,
  readWorkflowAgentTranscript,
  type WorkflowAgentTranscriptCursor,
} from "./workflowAgentAnswers.ts";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

const assistant = (id: string, content: ReadonlyArray<unknown>, uuid?: string) =>
  line({
    type: "assistant",
    ...(uuid === undefined ? {} : { uuid }),
    message: { role: "assistant", id, content },
  });

const parse = (contents: string, cursor?: Partial<WorkflowAgentTranscriptCursor>) =>
  parseWorkflowAgentTranscript({
    contents: `${cursor?.remainder ?? ""}${contents}`,
    answerText: cursor?.answerText,
    discarding: cursor?.discarding,
    atEof: true,
  });

describe("parseWorkflowAgentTranscript", () => {
  it("returns assistant text, thinking and tool calls in order", () => {
    const parsed = parse(
      assistant("a", [{ type: "thinking", thinking: "look" }], "u1") +
        assistant("a", [
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } },
        ]) +
        line({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "hi" }],
          },
        }) +
        assistant("a", [{ type: "text", text: "the answer" }]),
    );
    expect(parsed.items).toEqual([
      { type: "thinking", id: "u1:thinking:0", text: "look" },
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } },
      { type: "tool_result", id: "toolu_1", isError: false, output: "hi" },
      { type: "text", id: "a", text: "the answer" },
    ]);
  });

  it("joins the lines of one assistant message into a single turn", () => {
    const first = parse(assistant("a", [{ type: "text", text: "the answer" }]));
    const second = parse(assistant("a", [{ type: "text", text: "and more" }]), {
      answerText: first.answerText,
    });
    expect(second.items).toEqual([{ type: "text", id: "a", text: "the answer\n\nand more" }]);
  });

  it("ignores harness bookkeeping and the member's own prompt", () => {
    expect(
      parse(
        line({ type: "attachment", attachment: { type: "skill_listing", content: "- adhd" } }) +
          line({ type: "user", message: { role: "user", content: "the prompt" } }) +
          line({
            type: "assistant",
            isMeta: true,
            message: { role: "assistant", id: "m", content: [{ type: "text", text: "injected" }] },
          }) +
          assistant("a", [{ type: "text", text: "real answer" }]),
      ).items,
    ).toEqual([{ type: "text", id: "a", text: "real answer" }]);
  });

  it("keeps a tool call that produced no text", () => {
    expect(
      parse(assistant("a", [{ type: "tool_use", id: "t", name: "Bash", input: {} }])).items,
    ).toEqual([{ type: "tool_use", id: "t", name: "Bash", input: {} }]);
  });

  it("replaces image tool results and preserves answer indentation", () => {
    const parsed = parse(
      assistant("a", [{ type: "text", text: "    indented code" }]) +
        line({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_img",
                is_error: true,
                content: [{ type: "image", source: { type: "base64", data: "abc" } }],
              },
            ],
          },
        }),
    );
    expect(parsed.items).toEqual([
      { type: "text", id: "a", text: "    indented code" },
      { type: "tool_result", id: "toolu_img", isError: true, output: "[image]" },
    ]);
  });

  it("holds a trailing line the byte cap cut in half until the file ends", () => {
    const partial = parseWorkflowAgentTranscript({
      contents: assistant("a", [{ type: "text", text: "complete" }]) + '{"type":"assistant","mess',
      atEof: false,
    });
    expect(partial.items).toEqual([{ type: "text", id: "a", text: "complete" }]);
    expect(partial.remainder).toBe('{"type":"assistant","mess');
    const finished = parseWorkflowAgentTranscript({
      contents: `${partial.remainder}age":{"id":"b","content":[{"type":"text","text":"rest"}]}}\n`,
      answerText: partial.answerText,
      atEof: true,
    });
    expect(finished.items).toEqual([{ type: "text", id: "b", text: "rest" }]);
    expect(finished.remainder).toBe("");
  });

  it("skips a line longer than one read and resumes at the next newline", () => {
    const skipped = parseWorkflowAgentTranscript({
      contents: "not-a-complete-line-yet",
      discarding: true,
      atEof: false,
    });
    expect(skipped.items).toEqual([]);
    expect(skipped.discarding).toBe(true);
    const resumed = parseWorkflowAgentTranscript({
      contents: `still-junk\n${assistant("a", [{ type: "text", text: "after" }])}`,
      discarding: true,
      atEof: true,
    });
    expect(resumed.items).toEqual([{ type: "text", id: "a", text: "after" }]);
    expect(resumed.discarding).toBe(false);
  });
});

let configDir: string;
let transcriptDir: string;
beforeAll(() => {
  configDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wf-config-"));
  transcriptDir = NodePath.join(configDir, "projects", "test");
  NodeFS.mkdirSync(transcriptDir, { recursive: true });
});

afterAll(() => {
  NodeFS.rmSync(configDir, { recursive: true, force: true });
});

describe("readWorkflowAgentTranscript", () => {
  it("reads only the bytes added since the last offset", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = NodePath.join(transcriptDir, "agent-tail.jsonl");
        const write = (contents: string) => NodeFS.writeFileSync(path, contents);
        const read = (cursor: WorkflowAgentTranscriptCursor) =>
          readWorkflowAgentTranscript({ transcriptDir, agentId: "tail", configDir, cursor });
        write(assistant("a", [{ type: "text", text: "the answer" }]));
        const first = yield* read(emptyWorkflowAgentTranscriptCursor);
        expect(first.items).toEqual([{ type: "text", id: "a", text: "the answer" }]);
        expect(first.behind).toBe(false);
        const reread = yield* read(first.cursor);
        expect(reread.items).toEqual([]);
        NodeFS.appendFileSync(
          path,
          assistant("a", [
            { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "a.ts" } },
          ]),
        );
        const second = yield* read(first.cursor);
        expect(second.items).toEqual([
          { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "a.ts" } },
        ]);
        write(assistant("b", [{ type: "text", text: "rewritten" }]));
        const rewritten = yield* read(second.cursor);
        expect(rewritten.items).toEqual([{ type: "text", id: "b", text: "rewritten" }]);
      }),
    ));

  it("reports a transcript that is not there yet", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missing = yield* readWorkflowAgentTranscript({
          transcriptDir,
          agentId: "absent",
          configDir,
          cursor: emptyWorkflowAgentTranscriptCursor,
        });
        expect(missing.missing).toBe(true);
        expect(missing.items).toEqual([]);
      }),
    ));
});
