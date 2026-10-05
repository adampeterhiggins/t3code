import { assert, it } from "@effect/vitest";
import { CommandId, RunId, ThreadId } from "@t3tools/contracts";
import { USAGE_LIMIT_RESUME_GRACE_MS } from "@t3tools/shared/orchestrationV2ThreadError";
import * as DateTime from "effect/DateTime";

import type { ProjectionLimitRecoveryCandidate } from "./ProjectionStore.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

const stoppedAt = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
const resetAt = "2026-10-05T13:00:00.000Z";
const resetMs = Date.parse(resetAt);
const armed: ProjectionLimitRecoveryCandidate = {
  id: ThreadId.make("thread:limited"),
  status: "failed",
  lastErrorClass: "usage_limit",
  latestRunId: RunId.make("run:limited"),
  usageLimitResetAt: resetAt,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  latestRunCompletedAt: stoppedAt,
  updatedAt: stoppedAt,
  limitRecovery: {
    runId: RunId.make("run:limited"),
    resetAt,
    autoResume: true,
    requestId: CommandId.make("recovery:choice"),
  },
  snoozedUntil: null,
};

it("waits out the grace after the reset before auto-resuming", () => {
  assert.isNull(limitRecoveryCommand(armed, true, resetMs));
  assert.isNull(limitRecoveryCommand(armed, true, resetMs + USAGE_LIMIT_RESUME_GRACE_MS - 1));
  const resume = limitRecoveryCommand(armed, true, resetMs + USAGE_LIMIT_RESUME_GRACE_MS);
  assert.equal(resume?.type, "message.dispatch");
  assert.equal(
    resume?.type === "message.dispatch" ? resume.usageLimitContinuationOfRunId : null,
    armed.latestRunId,
  );
});
