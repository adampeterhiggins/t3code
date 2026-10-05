import {
  ComposerContextId,
  MessageId,
  PlanId,
  RunId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadProjectionFixture } from "../test-fixtures";
import { buildThreadTranscript, transcriptFileName } from "./threadTranscript";

const EXPORTED_AT = new Date("2026-09-30T15:18:00.000Z");
const RUN_ID = RunId.make("run-1");

function base(id: string, ordinal: number, at: string) {
  const time = DateTime.makeUnsafe(at);
  return {
    id: TurnItemId.make(id),
    threadId: makeThreadProjectionFixture().thread.id,
    runId: RUN_ID,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: time,
    completedAt: time,
    updatedAt: time,
  };
}

function user(id: string, ordinal: number, text: string, at: string) {
  return {
    ...base(id, ordinal, at),
    type: "user_message" as const,
    messageId: MessageId.make(`message-${id}`),
    inputIntent: "turn_start" as const,
    text,
    attachments: [],
    createdBy: "user" as const,
    creationSource: "web" as const,
  } satisfies OrchestrationV2TurnItem;
}

function assistant(id: string, ordinal: number, text: string, at: string) {
  return {
    ...base(id, ordinal, at),
    type: "assistant_message" as const,
    messageId: MessageId.make(`message-${id}`),
    text,
    streaming: false,
  } satisfies OrchestrationV2TurnItem;
}

const conversation: ReadonlyArray<OrchestrationV2TurnItem> = [
  user("u1", 0, "Can we deploy PRs to prod?", "2026-09-30T14:00:01.000Z"),
  {
    ...base("r1", 1, "2026-09-30T14:00:02.000Z"),
    type: "reasoning",
    text: "Thinking about workflows",
    streaming: false,
  },
  {
    ...base("p1", 2, "2026-09-30T14:00:04.000Z"),
    type: "proposed_plan",
    planId: PlanId.make("plan-1"),
    markdown: "1. Add a target input",
    streaming: false,
  },
  assistant("a1", 3, "Yes, behind a flag.", "2026-09-30T14:00:05.000Z"),
  user("u2", 4, "Go ahead.", "2026-09-30T14:01:00.000Z"),
  {
    ...base("c1", 5, "2026-09-30T14:01:30.000Z"),
    type: "command_execution",
    input: "make lint",
    output: "ok",
    exitCode: 0,
  },
  {
    ...base("f1", 6, "2026-09-30T14:01:40.000Z"),
    type: "file_change",
    fileName: "deploy.yml",
  },
  assistant("a2", 7, "Done.", "2026-09-30T14:02:00.000Z"),
];

function makeProjection(
  items: ReadonlyArray<OrchestrationV2TurnItem> = conversation,
): OrchestrationV2ThreadProjection {
  const fixture = makeThreadProjectionFixture();
  return {
    ...fixture,
    thread: {
      ...fixture.thread,
      title: "PR deployments: production endpoints",
      branch: "pr-deploy-prod",
      createdAt: DateTime.makeUnsafe("2026-09-30T14:00:00.000Z"),
    },
    visibleTurnItems: items.map((item, position) => ({
      position,
      visibility: "local" as const,
      sourceThreadId: fixture.thread.id,
      sourceItemId: item.id,
      item,
    })),
  };
}

describe("buildThreadTranscript", () => {
  it("keeps only the conversation in concise mode", () => {
    const transcript = buildThreadTranscript({
      projection: makeProjection(),
      projectTitle: "fd-manager",
      detail: "concise",
      includeHeader: false,
      exportedAt: EXPORTED_AT,
    });

    expect(transcript.markdown).toBe(
      [
        "# PR deployments: production endpoints",
        "## User",
        "Can we deploy PRs to prod?",
        "## Assistant",
        "Yes, behind a flag.",
        "## User",
        "Go ahead.",
        "## Assistant",
        "Done.",
      ].join("\n\n") + "\n",
    );
    expect(transcript.messageCount).toBe(4);
    expect(transcript.toolCallCount).toBe(0);
  });

  it("interleaves tool calls and plans under the assistant in full mode", () => {
    const transcript = buildThreadTranscript({
      projection: makeProjection(),
      projectTitle: null,
      detail: "full",
      includeHeader: false,
      exportedAt: EXPORTED_AT,
    });

    expect(transcript.markdown).toContain(
      ["## Assistant", "### Plan\n\n1. Add a target input", "Yes, behind a flag."].join("\n\n"),
    );
    expect(transcript.markdown).toContain(
      [
        "Go ahead.",
        "## Assistant",
        "- **Ran command** `make lint`\n- **Changed deploy.yml**: `deploy.yml`",
        "Done.",
      ].join("\n\n"),
    );
    expect(transcript.markdown).not.toContain("Thinking about workflows");
    expect(transcript.toolCallCount).toBe(2);
  });

  it("writes a quoted front matter header from the thread", () => {
    const { markdown } = buildThreadTranscript({
      projection: makeProjection(),
      projectTitle: "fd-manager",
      detail: "concise",
      includeHeader: true,
      exportedAt: EXPORTED_AT,
    });

    expect(
      markdown.startsWith(
        [
          "---",
          'thread: "PR deployments: production endpoints"',
          'project: "fd-manager"',
          'branch: "pr-deploy-prod"',
          'provider: "codex"',
          'model: "gpt-5.4"',
          "created: 2026-09-30T14:00:00.000Z",
          "exported: 2026-09-30T15:18:00.000Z",
          "---",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  it("replaces context chips with their labels and names unmentioned attachments", () => {
    const chip = formatComposerContextReference({
      kind: "file",
      contextId: ComposerContextId.make("ctx_1"),
      label: "deploy.yml",
    });
    const { markdown } = buildThreadTranscript({
      projection: makeProjection([
        {
          ...user("u1", 0, `Look at ${chip}`, "2026-09-30T14:00:01.000Z"),
          attachments: [
            {
              type: "image",
              id: "att-1",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 10,
            },
          ],
        },
      ]),
      projectTitle: null,
      detail: "concise",
      includeHeader: false,
      exportedAt: EXPORTED_AT,
    });

    expect(markdown).toContain("Look at deploy.yml\n\n[image: screenshot.png]");
    expect(markdown).not.toContain("t3-context:");
  });
});

describe("transcriptFileName", () => {
  it("slugs the title into a markdown file name", () => {
    expect(transcriptFileName("PR deployments: production endpoints!")).toBe(
      "pr-deployments-production-endpoints.md",
    );
    expect(transcriptFileName("🚀")).toBe("transcript.md");
  });
});
