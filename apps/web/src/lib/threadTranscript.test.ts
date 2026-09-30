import {
  ComposerContextId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadTranscript, transcriptFileName } from "./threadTranscript";

const EXPORTED_AT = new Date("2026-09-30T15:18:00.000Z");

function message(
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  createdAt: string,
  overrides: Partial<OrchestrationMessage> = {},
): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId: null,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "PR deployments: production endpoints",
    modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "pr-deploy-prod",
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-30T14:00:00.000Z",
    updatedAt: "2026-09-30T15:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    pullRequests: [],
    deletedAt: null,
    messages: [
      message("m1", "user", "Can we deploy PRs to prod?", "2026-09-30T14:00:01.000Z"),
      message("m2", "reasoning", "Thinking about workflows", "2026-09-30T14:00:02.000Z"),
      message("m3", "assistant", "Yes, behind a flag.", "2026-09-30T14:00:05.000Z"),
      message("m4", "user", "Go ahead.", "2026-09-30T14:01:00.000Z"),
      message("m5", "assistant", "Done.", "2026-09-30T14:02:00.000Z"),
    ],
    proposedPlans: [],
    activities: [
      {
        id: EventId.make("a1"),
        tone: "tool",
        kind: "tool.completed",
        summary: "Ran command",
        payload: { itemType: "command_execution", data: { item: { command: ["make", "lint"] } } },
        turnId: null,
        sequence: 1,
        createdAt: "2026-09-30T14:01:30.000Z",
      },
    ],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

describe("buildThreadTranscript", () => {
  it("keeps only the conversation in concise mode", () => {
    const transcript = buildThreadTranscript({
      thread: makeThread(),
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
      thread: makeThread({
        proposedPlans: [
          {
            id: "plan-1",
            turnId: null,
            planMarkdown: "1. Add a target input",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-09-30T14:00:04.000Z",
            updatedAt: "2026-09-30T14:00:04.000Z",
          },
        ],
      }),
      projectTitle: null,
      detail: "full",
      includeHeader: false,
      exportedAt: EXPORTED_AT,
    });

    expect(transcript.markdown).toContain(
      ["## Assistant", "### Plan\n\n1. Add a target input", "Yes, behind a flag."].join("\n\n"),
    );
    expect(transcript.markdown).toContain(
      ["Go ahead.", "## Assistant", "- **Ran command** `make lint`", "Done."].join("\n\n"),
    );
    expect(transcript.markdown).not.toContain("Thinking about workflows");
    expect(transcript.toolCallCount).toBe(1);
  });

  it("writes a quoted front matter header", () => {
    const { markdown } = buildThreadTranscript({
      thread: makeThread(),
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
          'provider: "claudeAgent"',
          'model: "claude-opus"',
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
      thread: makeThread({
        messages: [
          message("m1", "user", `Look at ${chip}`, "2026-09-30T14:00:01.000Z", {
            attachments: [
              {
                type: "image",
                id: "att-1",
                name: "screenshot.png",
                mimeType: "image/png",
                sizeBytes: 10,
              },
            ],
          }),
        ],
      }),
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
