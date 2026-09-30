/**
 * Recovery state for a thread whose last turn stopped on a provider usage
 * limit. The server's resume reactor, web, and mobile all derive it from the
 * thread's activities with this one function, so they agree on when the
 * recovery actions show and whether an automatic resume is armed.
 *
 * @module usageLimitRecovery
 */
import type {
  EventId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

/** Activity recording that the user armed an automatic resume for one stop. */
export const USAGE_LIMIT_RESUME_SCHEDULED_KIND = "usage-limit.resume-scheduled";
/** Activity recording that the user disarmed it again. */
export const USAGE_LIMIT_RESUME_CANCELLED_KIND = "usage-limit.resume-cancelled";
/** The message a resume sends into the same session. */
export const USAGE_LIMIT_RESUME_PROMPT = "Continue where you left off.";

/** Providers report the reset to the second; give the window a moment to reopen. */
const RESUME_GRACE_MS = 60_000;

export interface UsageLimitRecovery {
  /** The `runtime.error` activity that recorded the stop. */
  readonly errorActivityId: EventId;
  readonly message: string;
  /** When the exhausted window reopens, if the provider said. */
  readonly resetsAt: string | null;
  /** When an armed automatic resume fires; null while none is armed. */
  readonly scheduledResumeAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isAfter(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}

/**
 * The open usage-limit interruption, or null when the latest runtime error was
 * something else, or a later message or running turn has moved past it.
 * `activities` are in thread order.
 */
export function deriveUsageLimitRecovery(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly latestUserMessageAt: string | null;
  readonly sessionStatus: OrchestrationSessionStatus | null;
}): UsageLimitRecovery | null {
  if (input.sessionStatus === "running" || input.sessionStatus === "starting") return null;
  // Walking backwards, the first schedule or cancel seen for a stop is its latest.
  const latestResumeChange = new Map<string, string | null>();
  for (let index = input.activities.length - 1; index >= 0; index--) {
    const activity = input.activities[index]!;
    const payload = asRecord(activity.payload);
    if (
      activity.kind === USAGE_LIMIT_RESUME_SCHEDULED_KIND ||
      activity.kind === USAGE_LIMIT_RESUME_CANCELLED_KIND
    ) {
      const errorActivityId = payload?.errorActivityId;
      if (typeof errorActivityId !== "string" || latestResumeChange.has(errorActivityId)) continue;
      const resumeAt = payload?.resumeAt;
      latestResumeChange.set(
        errorActivityId,
        activity.kind === USAGE_LIMIT_RESUME_SCHEDULED_KIND && typeof resumeAt === "string"
          ? resumeAt
          : null,
      );
      continue;
    }
    if (activity.kind !== "runtime.error") continue;
    const usageLimit = asRecord(payload?.usageLimit);
    if (usageLimit === null) return null;
    if (
      input.latestUserMessageAt !== null &&
      isAfter(input.latestUserMessageAt, activity.createdAt)
    )
      return null;
    const message = payload?.message;
    const resetsAt = usageLimit.resetsAt;
    return {
      errorActivityId: activity.id,
      message: typeof message === "string" ? message : activity.summary,
      resetsAt: typeof resetsAt === "string" ? resetsAt : null,
      scheduledResumeAt: latestResumeChange.get(activity.id) ?? null,
    };
  }
  return null;
}

/**
 * When "Resume when available" should fire: shortly after the reset, or now
 * when the reset has already passed. Null when the provider gave no reset time,
 * so there is nothing to wait for.
 */
export function usageLimitResumeAt(resetsAt: string | null, nowMs: number): string | null {
  if (resetsAt === null) return null;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const resumeAt = DateTime.make(Math.max(resetMs + RESUME_GRACE_MS, nowMs));
  return Option.isSome(resumeAt) ? DateTime.formatIso(resumeAt.value) : null;
}
