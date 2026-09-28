import { describe, expect, it } from "@effect/vitest";
import { MessageId, type OrchestrationMessage } from "@t3tools/contracts";
import { summarizeSiblingMessages } from "./summary.ts";

const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  streaming = false,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text,
  turnId: null,
  streaming,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("sibling chat handoff", () => {
  it("keeps the initial request and recent settled conversation, excluding reasoning and live output", () => {
    const messages = [
      message("first", "user", "Build the search view"),
      ...Array.from({ length: 12 }, (_, index) =>
        message(`middle-${index}`, "assistant", `Old detail ${index}`),
      ),
      message("reasoning", "reasoning", "private trace"),
      message("live", "assistant", "unfinished", true),
      message("last", "assistant", "Search view is ready"),
    ];
    const summary = summarizeSiblingMessages("Search work", messages);
    expect(summary).toContain("Build the search view");
    expect(summary).toContain("Search view is ready");
    expect(summary).not.toContain("Old detail 0");
    expect(summary).not.toContain("private trace");
    expect(summary).not.toContain("unfinished");
  });

  it("bounds one unusually long source chat", () => {
    const summary = summarizeSiblingMessages(
      "Large chat",
      Array.from({ length: 20 }, (_, index) =>
        message(`${index}`, "assistant", "x".repeat(20_000)),
      ),
    );
    expect(summary.length).toBeLessThanOrEqual(8_000);
  });
});
