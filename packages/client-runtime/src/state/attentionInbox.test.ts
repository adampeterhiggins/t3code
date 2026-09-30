import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildAttentionInbox,
  resolveThreadAttention,
  type AttentionThread,
} from "./attentionInbox.ts";

const NOW = "2026-04-10T12:00:00.000Z";
const VISITED = "2026-04-10T10:00:00.000Z";
const AFTER_VISIT = "2026-04-10T11:00:00.000Z";
const BEFORE_VISIT = "2026-04-10T09:00:00.000Z";

function makeThread(
  id: string,
  input: {
    readonly environmentId?: string;
    readonly pending?: "approval" | "input";
    readonly sessionStatus?: "running" | "ready" | "error";
    readonly sessionUpdatedAt?: string;
    readonly turnState?: "completed" | "error" | "running";
    readonly turnCompletedAt?: string | null;
    readonly updatedAt?: string;
    readonly archivedAt?: string | null;
    readonly snoozedUntil?: string | null;
    readonly backgroundLiveness?: "working" | "monitoring" | null;
  } = {},
): AttentionThread {
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    environmentId: EnvironmentId.make(input.environmentId ?? "env-1"),
    archivedAt: input.archivedAt ?? null,
    updatedAt: input.updatedAt ?? AFTER_VISIT,
    backgroundLiveness: input.backgroundLiveness ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    snoozedAt: input.snoozedUntil ? BEFORE_VISIT : null,
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "input",
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId,
            status: input.sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: input.sessionStatus === "error" ? "boom" : null,
            updatedAt: input.sessionUpdatedAt ?? AFTER_VISIT,
          },
    latestTurn:
      input.turnCompletedAt === undefined
        ? null
        : {
            turnId: TurnId.make(`${id}-turn`),
            state: input.turnState ?? "completed",
            requestedAt: BEFORE_VISIT,
            startedAt: BEFORE_VISIT,
            completedAt: input.turnCompletedAt,
            assistantMessageId: null,
          },
  };
}

const visitedEverything = (threads: ReadonlyArray<AttentionThread>) =>
  Object.fromEntries(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, VISITED]));

describe("resolveThreadAttention", () => {
  it("prefers an approval over an unread completion on the same thread", () => {
    const thread = makeThread("t", { pending: "approval", turnCompletedAt: AFTER_VISIT });
    expect(resolveThreadAttention(thread, VISITED)?.reason).toBe("approval");
  });

  it("keeps requests even after the thread was visited", () => {
    const thread = makeThread("t", { pending: "input", updatedAt: BEFORE_VISIT });
    expect(resolveThreadAttention(thread, VISITED)?.reason).toBe("input");
  });

  it("reports a failure only until the thread is visited", () => {
    const thread = makeThread("t", {
      sessionStatus: "error",
      turnState: "error",
      turnCompletedAt: AFTER_VISIT,
    });
    expect(resolveThreadAttention(thread, VISITED)).toEqual({
      reason: "failed",
      at: AFTER_VISIT,
    });
    expect(resolveThreadAttention(thread, NOW)).toBeNull();
  });

  it("does not fall back to completed when a seen failure is dismissed", () => {
    const thread = makeThread("t", { turnState: "error", turnCompletedAt: BEFORE_VISIT });
    expect(resolveThreadAttention(thread, VISITED)).toBeNull();
  });

  it("ignores threads that are still working, including background work", () => {
    expect(
      resolveThreadAttention(
        makeThread("t", { sessionStatus: "running", turnCompletedAt: AFTER_VISIT }),
        VISITED,
      ),
    ).toBeNull();
    expect(
      resolveThreadAttention(
        makeThread("t", { backgroundLiveness: "monitoring", turnCompletedAt: AFTER_VISIT }),
        VISITED,
      ),
    ).toBeNull();
  });

  it("treats a missing visit marker as read, like the sidebar", () => {
    const thread = makeThread("t", { turnCompletedAt: AFTER_VISIT });
    expect(resolveThreadAttention(thread, undefined)).toBeNull();
    expect(resolveThreadAttention(thread, VISITED)?.reason).toBe("completed");
  });
});

describe("buildAttentionInbox", () => {
  it("orders by urgency, then newest first, with one entry per thread", () => {
    const threads = [
      makeThread("old-done", { turnCompletedAt: "2026-04-10T10:30:00.000Z" }),
      makeThread("new-done", { turnCompletedAt: "2026-04-10T11:30:00.000Z" }),
      makeThread("failed", { sessionStatus: "error" }),
      makeThread("input", { pending: "input" }),
      makeThread("approval", { pending: "approval", turnCompletedAt: AFTER_VISIT }),
      makeThread("approval", { pending: "approval", turnCompletedAt: AFTER_VISIT }),
      makeThread("quiet", { turnCompletedAt: BEFORE_VISIT }),
    ];
    const inbox = buildAttentionInbox(threads, {
      lastVisitedAtByKey: visitedEverything(threads),
      now: NOW,
    });
    expect(inbox.map((entry) => [entry.thread.id, entry.reason])).toEqual([
      ["approval", "approval"],
      ["input", "input"],
      ["failed", "failed"],
      ["new-done", "completed"],
      ["old-done", "completed"],
    ]);
  });

  it("keeps same thread ids from different environments apart", () => {
    const threads = [
      makeThread("t", { environmentId: "env-1", pending: "input" }),
      makeThread("t", { environmentId: "env-2", pending: "input" }),
    ];
    const inbox = buildAttentionInbox(threads, { lastVisitedAtByKey: {}, now: NOW });
    expect(inbox.map((entry) => entry.key)).toEqual(["env-1:t", "env-2:t"]);
  });

  it("leaves out archived and snoozed threads until a snoozed one raises its hand", () => {
    const snoozeUntil = "2026-04-11T09:00:00.000Z";
    const threads = [
      makeThread("archived", { pending: "input", archivedAt: VISITED }),
      makeThread("snoozed", { snoozedUntil: snoozeUntil, turnCompletedAt: BEFORE_VISIT }),
      makeThread("snoozed-asks", { snoozedUntil: snoozeUntil, pending: "approval" }),
    ];
    const inbox = buildAttentionInbox(threads, {
      lastVisitedAtByKey: visitedEverything(threads),
      now: NOW,
    });
    expect(inbox.map((entry) => entry.thread.id)).toEqual(["snoozed-asks"]);
  });
});
