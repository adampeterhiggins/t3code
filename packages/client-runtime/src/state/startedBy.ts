import type { ScopedThreadRef } from "@t3tools/contracts";

import { scopeThreadRef } from "../environment/scoped.ts";
import type { EnvironmentThreadShell } from "./models.ts";

type StartedByThread = Pick<EnvironmentThreadShell, "environmentId" | "startedBy">;

/** The thread whose agent started `thread`, for looking up its shell. */
export function startedByThreadRef(thread: StartedByThread | null): ScopedThreadRef | null {
  return thread?.startedBy?.kind === "thread"
    ? scopeThreadRef(thread.environmentId, thread.startedBy.threadId)
    : null;
}

/**
 * How to attribute a thread an agent started, or null when the user started it.
 * `starter` is the starting thread's shell; when it is not loaded (archived or
 * deleted) the label falls back to "an archived thread" with nothing to open.
 */
export function resolveStartedBy(
  thread: StartedByThread | null,
  starter: Pick<EnvironmentThreadShell, "title"> | null,
): {
  readonly label: string;
  readonly description: string;
  readonly openRef: ScopedThreadRef | null;
} | null {
  const startedBy = thread?.startedBy ?? null;
  if (startedBy === null) return null;
  if (startedBy.kind === "agent-access") {
    return {
      label: startedBy.label,
      description: `Started by the agent using ${startedBy.label}`,
      openRef: null,
    };
  }
  const label = starter?.title ?? "an archived thread";
  return {
    label,
    description: `Started by the agent in ${label}`,
    openRef: starter === null ? null : startedByThreadRef(thread),
  };
}
