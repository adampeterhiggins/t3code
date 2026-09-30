import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  USAGE_LIMIT_RESUME_CANCELLED_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_KIND,
  deriveUsageLimitRecovery,
  usageLimitResumeAt,
} from "./usageLimitRecovery.ts";

const RESET_AT = "2026-01-01T03:00:00.000Z";

function runtimeError(
  id: string,
  createdAt: string,
  usageLimit?: { resetsAt?: string },
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    kind: "runtime.error",
    summary: "Runtime error",
    tone: "error",
    turnId: TurnId.make(`turn-${id}`),
    createdAt,
    payload: { message: `failed: ${id}`, ...(usageLimit ? { usageLimit } : {}) },
  };
}

function resumeChange(
  kind: typeof USAGE_LIMIT_RESUME_SCHEDULED_KIND | typeof USAGE_LIMIT_RESUME_CANCELLED_KIND,
  errorActivityId: string,
  createdAt: string,
  resumeAt?: string,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`${kind}:${createdAt}`),
    kind,
    summary: kind,
    tone: "info",
    turnId: null,
    createdAt,
    payload: { errorActivityId, ...(resumeAt ? { resumeAt } : {}) },
  };
}

const stop = runtimeError("limit", "2026-01-01T00:00:00.000Z", { resetsAt: RESET_AT });
const derive = (
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  overrides: Partial<Parameters<typeof deriveUsageLimitRecovery>[0]> = {},
) =>
  deriveUsageLimitRecovery({
    activities,
    latestUserMessageAt: "2025-12-31T23:59:00.000Z",
    sessionStatus: "error",
    ...overrides,
  });

describe("deriveUsageLimitRecovery", () => {
  it("offers recovery for a usage-limit stop with its reset time", () => {
    expect(derive([stop])).toEqual({
      errorActivityId: stop.id,
      message: "failed: limit",
      resetsAt: RESET_AT,
      scheduledResumeAt: null,
    });
  });

  it("closes once the thread moves past the stop", () => {
    expect(derive([stop], { latestUserMessageAt: "2026-01-01T00:10:00.000Z" })).toBeNull();
    expect(derive([stop], { sessionStatus: "running" })).toBeNull();
    // A later, unrelated failure is what the thread is showing now.
    expect(derive([stop, runtimeError("other", "2026-01-01T00:20:00.000Z")])).toBeNull();
  });

  it("tracks arming and disarming for this stop only", () => {
    const armed = resumeChange(
      USAGE_LIMIT_RESUME_SCHEDULED_KIND,
      stop.id,
      "2026-01-01T00:01:00.000Z",
      RESET_AT,
    );
    expect(derive([stop, armed])?.scheduledResumeAt).toBe(RESET_AT);
    const cancelled = resumeChange(
      USAGE_LIMIT_RESUME_CANCELLED_KIND,
      stop.id,
      "2026-01-01T00:02:00.000Z",
    );
    expect(derive([stop, armed, cancelled])?.scheduledResumeAt).toBeNull();

    // An opt-in for an earlier stop does not carry over to a new one.
    const earlier = runtimeError("earlier", "2025-12-31T20:00:00.000Z", {});
    const earlierArm = resumeChange(
      USAGE_LIMIT_RESUME_SCHEDULED_KIND,
      earlier.id,
      "2025-12-31T20:01:00.000Z",
      RESET_AT,
    );
    expect(derive([earlier, earlierArm, stop])?.scheduledResumeAt).toBeNull();
  });
});

describe("usageLimitResumeAt", () => {
  it("waits a moment past the reset, or resumes now once it has passed", () => {
    expect(usageLimitResumeAt(RESET_AT, Date.parse("2026-01-01T00:00:00.000Z"))).toBe(
      "2026-01-01T03:01:00.000Z",
    );
    expect(usageLimitResumeAt(RESET_AT, Date.parse("2026-01-01T04:00:00.000Z"))).toBe(
      "2026-01-01T04:00:00.000Z",
    );
    expect(usageLimitResumeAt(null, 0)).toBeNull();
  });
});
