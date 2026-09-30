import {
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
  type PullRequestWatch,
  ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  PULL_REQUEST_WATCH_MAX_ATTEMPTS,
  type PullRequestWatchProblem,
  evaluatePullRequestWatch,
} from "@t3tools/shared/pullRequestWatch";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { threadHasQueuedTurnStart } from "../orchestration/ThreadSettlementPolicy.ts";
import { forkParked } from "../serverActivation.ts";
import {
  deletePullRequestWatches,
  listPullRequestWatches,
  upsertPullRequestWatch,
} from "./store.ts";

/**
 * Follows watched pull requests on the server, so it keeps going with every client closed.
 * A thread is re-read when one of its pull request snapshots syncs or its session changes. When
 * the host reports work the agent has not been asked about, and the thread is idle, it starts a
 * follow-up turn. Each watch has a budget of follow-ups, and ends when its pull request merges
 * or closes.
 */
export class PullRequestWatchReactor extends Context.Service<
  PullRequestWatchReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
    readonly evaluate: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/pullRequestWatch/reactor/PullRequestWatchReactor") {}

const PROBLEM_INSTRUCTIONS: Record<PullRequestWatchProblem, string> = {
  checks: "CI checks are failing. Read the failing logs, fix the cause, and push.",
  review:
    "A reviewer requested changes. Read the review comments, address them, push, and reply where useful.",
  conflict: "The branch has merge conflicts with its base. Rebase or merge the base, and push.",
};

function pullRequestWatchPrompt(
  link: ThreadPullRequestLink,
  problems: ReadonlyArray<PullRequestWatchProblem>,
  attempt: number,
): string {
  const branch = link.snapshot === null ? "" : ` (branch \`${link.snapshot.headBranch}\`)`;
  const tools =
    link.host === "github.com"
      ? `\`gh pr view ${link.number} --comments\` and \`gh pr checks ${link.number}\``
      : "the host's CLI or API";
  return [
    `Pull request #${link.number}${branch} needs follow-up: ${link.url}`,
    "",
    ...problems.map((problem) => `- ${PROBLEM_INSTRUCTIONS[problem]}`),
    "",
    `Inspect the pull request with ${tools}. If something needs a human decision, stop and say so instead of guessing.`,
    "",
    `This is automatic follow-up ${attempt} of ${PULL_REQUEST_WATCH_MAX_ATTEMPTS} from watching this pull request.`,
  ].join("\n");
}

/** Mirrors the settlement guards: anything that means the agent is, or is about to be, busy. */
function threadIsBusy(thread: OrchestrationThreadShell, now: string): boolean {
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.backgroundLiveness != null ||
    threadHasQueuedTurnStart(thread, now)
  );
}

function sameHandled(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const startFollowUp = Effect.fn("PullRequestWatchReactor.startFollowUp")(function* (
    thread: OrchestrationThreadShell,
    watch: PullRequestWatch,
    link: ThreadPullRequestLink,
    problems: ReadonlyArray<PullRequestWatchProblem>,
    handled: ReadonlyArray<string>,
    now: string,
  ) {
    const attempt = watch.attemptsUsed + 1;
    // Recorded first, so a repeated evaluation cannot start the same follow-up twice.
    yield* upsertPullRequestWatch({ ...watch, attemptsUsed: attempt, handled, updatedAt: now });
    const uuid = yield* crypto.randomUUIDv4;
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`server:pr-watch:${thread.id}:${uuid}`),
        threadId: thread.id,
        message: {
          messageId: MessageId.make(`pr-watch:${uuid}`),
          role: "user",
          text: pullRequestWatchPrompt(link, problems, attempt),
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: now,
      })
      .pipe(Effect.onError(() => upsertPullRequestWatch(watch).pipe(Effect.ignore)));
  });

  const run = Effect.fn("PullRequestWatchReactor.run")(
    function* (threadId: ThreadId) {
      const watches = yield* listPullRequestWatches(threadId);
      if (watches.length === 0) return;
      const shell = yield* snapshots.getThreadShellById(threadId);
      if (Option.isNone(shell)) {
        yield* deletePullRequestWatches(threadId);
        return;
      }
      const thread = shell.value;
      if (thread.archivedAt !== null) return;
      const now = DateTime.formatIso(yield* DateTime.now);
      let busy = threadIsBusy(thread, now);
      const links = visibleThreadPullRequests(thread.pullRequests);
      for (const watch of watches) {
        const link = links.find((candidate) => threadPullRequestKeysEqual(candidate, watch));
        if (link === undefined) {
          yield* deletePullRequestWatches(threadId, watch);
          continue;
        }
        const evaluation = evaluatePullRequestWatch(watch, link.snapshot);
        if (evaluation.kind === "done") {
          yield* deletePullRequestWatches(threadId, watch);
        } else if (evaluation.kind === "handled") {
          if (!sameHandled(evaluation.handled, watch.handled)) {
            yield* upsertPullRequestWatch({
              ...watch,
              handled: evaluation.handled,
              updatedAt: now,
            });
          }
        } else if (evaluation.kind === "follow-up" && !busy) {
          // One follow-up at a time; the next watch is re-read when this turn's session settles.
          busy = true;
          yield* startFollowUp(thread, watch, link, evaluation.problems, evaluation.handled, now);
        }
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("pull request watch evaluation failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(run);

  const processEvent = (event: OrchestrationEvent) => {
    switch (event.type) {
      case "thread.pull-request-synced":
      case "thread.pull-request-unlinked":
      case "thread.session-set":
      case "thread.deleted":
        return worker.enqueue(event.payload.threadId);
    }
    return Effect.void;
  };

  const start: PullRequestWatchReactor["Service"]["start"] = Effect.fn(
    "PullRequestWatchReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(Stream.runForEach(events, processEvent));
    // Catch up on anything that changed while the server was down.
    const watches = yield* listPullRequestWatches().pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.catchCause((cause) =>
        Effect.logWarning("listing pull request watches failed", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as([])),
      ),
    );
    yield* Effect.forEach(new Set(watches.map((watch) => watch.threadId)), worker.enqueue, {
      discard: true,
    });
  });

  return {
    start,
    drain: worker.drain,
    evaluate: worker.enqueue,
  } satisfies PullRequestWatchReactor["Service"];
});

export const layer = Layer.effect(PullRequestWatchReactor, make);
