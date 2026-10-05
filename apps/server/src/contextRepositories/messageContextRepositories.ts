import {
  type OrchestrationMessageContext,
  RepositoryContextRecord,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ContextRepositories from "./ContextRepositories.ts";

const isRepositoryContextRecord = Schema.is(RepositoryContextRecord);

/** The message's `repository` records: repositories to clone before its turn starts. */
export const messageRepositoryRecords = (context: OrchestrationMessageContext | undefined) =>
  (context?.records ?? []).filter(isRepositoryContextRecord);

/** One line for the setup card: how the attached repositories came out. */
export function summarizeContextRepositoryOutcomes(
  records: ReadonlyArray<RepositoryContextRecord>,
): { readonly ok: boolean; readonly detail: string } {
  const counts = { cloned: 0, present: 0, conflict: 0, failed: 0 };
  for (const record of records) if (record.outcome) counts[record.outcome.status] += 1;
  const parts = [
    ...(counts.cloned > 0 ? [`${counts.cloned} cloned`] : []),
    ...(counts.present > 0 ? [`${counts.present} already present`] : []),
    ...(counts.conflict > 0 ? [`${counts.conflict} blocked by an existing folder`] : []),
    ...(counts.failed > 0 ? [`${counts.failed} failed`] : []),
  ];
  return { ok: counts.conflict + counts.failed === 0, detail: parts.join(", ") };
}

/**
 * Clones the message's attached repositories into `cwd` and returns its
 * context with each record's outcome filled in, so the persisted message (and
 * through it the chip and the agent's prompt) says what happened. Progress goes
 * to the thread's `context-repositories` setup stage when one is tracked.
 * Never fails: a clone problem is a warning on its record.
 */
export const ensureMessageContextRepositories = Effect.fn("ensureMessageContextRepositories")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly context: OrchestrationMessageContext;
  }) {
    const records = messageRepositoryRecords(input.context);
    if (records.length === 0) return input.context;
    const contextRepositories = yield* ContextRepositories.ContextRepositories;
    const tracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
    const directory = yield* (yield* ServerSettings.ServerSettingsService).getSettings.pipe(
      Effect.map((settings) => settings.contextRepositoryDirectory),
      Effect.orElseSucceed(() => ""),
    );
    const { threadId } = input;
    const total = records.length;
    let finished = 0;
    const lastStep = new Map<string, number>();
    yield* tracker.stageStatus(threadId, "context-repositories", "running", `0 of ${total}`);
    const ensured = yield* contextRepositories.ensure({
      cwd: input.cwd,
      directory,
      repositories: records,
      onProgress: (event) => {
        switch (event.type) {
          case "started":
            return Effect.void;
          case "clone-progress": {
            // Git redraws its counters many times a second; only whole
            // steps of 10% reach the card.
            const percent = event.line.percent ?? 0;
            const key = `${event.record.contextId}:${event.line.stage}`;
            const step = Math.floor(percent / 10);
            if (lastStep.get(key) === step) return Effect.void;
            lastStep.set(key, step);
            return tracker.stage(threadId, "context-repositories", {
              detail: `${finished} of ${total} · ${event.record.nameWithOwner} ${event.line.stage} ${percent}%`,
            });
          }
          case "finished": {
            finished += 1;
            const { outcome, record } = event;
            const progress = tracker.stage(threadId, "context-repositories", {
              detail: `${finished} of ${total}`,
            });
            // Only problems reach the tail; the card shows it under a warning.
            return outcome.status === "failed" || outcome.status === "conflict"
              ? progress.pipe(
                  Effect.andThen(
                    tracker.appendTail(
                      threadId,
                      "context-repositories",
                      `${record.nameWithOwner}: ${outcome.detail ?? outcome.status}`,
                    ),
                  ),
                )
              : progress;
          }
        }
      },
    });
    const summary = summarizeContextRepositoryOutcomes(ensured);
    yield* tracker.stageStatus(
      threadId,
      "context-repositories",
      summary.ok ? "done" : "warning",
      summary.detail,
    );
    const byId = new Map(ensured.map((record) => [record.contextId, record]));
    return {
      ...input.context,
      records: input.context.records.map((record) => byId.get(record.contextId) ?? record),
    };
  },
);
