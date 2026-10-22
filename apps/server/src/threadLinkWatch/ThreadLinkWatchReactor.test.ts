import {
  type ChatThreadMessage,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  RunId,
  type SlackThreadContext,
  ThreadId,
  ThreadLinkWatchError,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { baselineOf, slackSnapshot } from "./linkWatchSnapshot.ts";
import * as ThreadLinkWatchReactor from "./ThreadLinkWatchReactor.ts";
import * as ThreadLinkWatches from "./ThreadLinkWatches.ts";

const THREAD_ID = ThreadId.make("thread-1");
const URL = "https://acme.slack.com/archives/C1/p1000100";

const message = (index: number, authorName: string, text: string): ChatThreadMessage => ({
  index,
  authorName,
  avatarUrl: null,
  postedAt: `2026-10-22T10:0${index}:00.000Z`,
  text,
  files: [],
  linked: index === 0,
});

const thread = (...messages: ReadonlyArray<ChatThreadMessage>): SlackThreadContext => ({
  teamId: "T1",
  channelId: "C1",
  channelLabel: "#eng",
  ts: "1.000100",
  threadTs: null,
  url: URL,
  authorName: "Ada",
  title: "Review the plan",
  replyCount: messages.length - 1,
  scope: "thread",
  markdown: messages.map((entry) => entry.text).join("\n"),
  messages: [...messages],
});

const ROOT = message(0, "Ada", "Review the plan");

const makeHarness = (initial: SlackThreadContext = thread(ROOT)) => {
  let watches: Array<ThreadLinkWatches.StoredLinkWatch> = [
    {
      threadId: THREAD_ID,
      kind: "slack",
      url: URL,
      startedAt: "2026-10-22T10:00:00.000Z",
      wakes: 0,
      baseline: baselineOf(slackSnapshot(initial)),
    },
  ];
  const state = {
    read: { _tag: "read", url: URL, snapshot: slackSnapshot(initial) } as
      | ThreadLinkWatches.LinkRead
      | "fail",
    reads: 0,
    shell: liveThreadShell(THREAD_ID, { activeRunId: null }) as OrchestrationV2ThreadShell | null,
    rejectWake: false,
  };
  const dispatched: Array<OrchestrationV2ServerCommand> = [];

  const dependencies = Layer.mergeAll(
    Layer.mock(ThreadLinkWatches.ThreadLinkWatches)({
      list: Effect.sync(() => watches),
      readLink: () =>
        Effect.suspend(() => {
          state.reads += 1;
          return state.read === "fail"
            ? Effect.fail(
                new ThreadLinkWatchError({ reason: "unreadable", detail: "Slack is down" }),
              )
            : Effect.succeed(state.read);
        }),
      advance: (current, next) =>
        Effect.sync(() => {
          watches = watches.map((watch) =>
            watch.startedAt === current.startedAt ? { ...watch, ...next } : watch,
          );
        }),
      end: (current) =>
        Effect.sync(() => {
          watches = watches.filter((watch) => watch.startedAt !== current.startedAt);
        }),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: () => Effect.sync(() => state.shell),
      dispatch: (command) =>
        Effect.suspend(() => {
          if (state.rejectWake) return Effect.die("rejected");
          dispatched.push(command);
          return Effect.succeed({ sequence: dispatched.length } as never);
        }),
    }),
  );

  // One reactor per harness: it remembers read times and failures between sweeps.
  const start = ThreadLinkWatchReactor.make.pipe(
    Effect.provide(dependencies),
    Effect.map((reactor) => reactor.sweep),
  );

  const setThread = (context: SlackThreadContext) => {
    state.read = { _tag: "read", url: URL, snapshot: slackSnapshot(context) };
  };

  return {
    state,
    dispatched,
    start,
    setThread,
    watches: () => watches,
  };
};

const wakes = (dispatched: ReadonlyArray<OrchestrationV2ServerCommand>) =>
  dispatched.flatMap((command) => (command.type === "thread.link-watch.wake" ? [command] : []));

describe("ThreadLinkWatchReactor", () => {
  it.effect("wakes the thread once per change and keeps watching", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const harnessSweep = yield* harness.start;
      yield* harnessSweep;
      expect(harness.dispatched).toEqual([]);

      harness.setThread(thread(ROOT, message(1, "Ben", "Ship it")));
      yield* TestClock.adjust("1 minute");
      yield* harnessSweep;
      const [wake] = wakes(harness.dispatched);
      expect(wake).toMatchObject({
        threadId: THREAD_ID,
        commandId: `server:link-watch:${THREAD_ID}:slack:2026-10-22T10:00:00.000Z:1`,
        notification: { summary: "Slack thread Review the plan: 1 new message" },
      });
      expect(wake?.text).toContain("Ben at 2026-10-22T10:01:00.000Z: Ship it");
      expect(harness.watches()[0]?.wakes).toBe(1);

      yield* TestClock.adjust("1 minute");
      yield* harnessSweep;
      expect(wakes(harness.dispatched)).toHaveLength(1);
    }),
  );

  it.effect("reads each kind no more often than its schedule", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const harnessSweep = yield* harness.start;
      yield* harnessSweep;
      yield* TestClock.adjust("30 seconds");
      yield* harnessSweep;
      expect(harness.state.reads).toBe(1);
      yield* TestClock.adjust("30 seconds");
      yield* harnessSweep;
      expect(harness.state.reads).toBe(2);
    }),
  );

  it.effect("holds changes while the thread runs and wakes it once afterwards", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const harnessSweep = yield* harness.start;
      harness.state.shell = liveThreadShell(THREAD_ID, { activeRunId: RunId.make("run-1") });
      harness.setThread(thread(ROOT, message(1, "Ben", "One")));
      yield* harnessSweep;
      harness.setThread(thread(ROOT, message(1, "Ben", "One"), message(2, "Cy", "Two")));
      yield* TestClock.adjust("1 minute");
      yield* harnessSweep;
      expect(harness.state.reads).toBe(0);
      expect(harness.dispatched).toEqual([]);

      harness.state.shell = liveThreadShell(THREAD_ID, { activeRunId: null });
      yield* TestClock.adjust("1 minute");
      yield* harnessSweep;
      const [wake] = wakes(harness.dispatched);
      expect(wake?.text).toContain("2 new messages");
    }),
  );

  it.effect("ends the watch without a wake when the thread archives or the link goes", () =>
    Effect.gen(function* () {
      const archived = makeHarness();
      const archivedSweep = yield* archived.start;
      archived.state.shell = {
        ...liveThreadShell(THREAD_ID, { activeRunId: null }),
        archivedAt: DateTime.makeUnsafe("2026-10-22T11:00:00.000Z"),
      };
      yield* archivedSweep;
      expect(archived.watches()).toEqual([]);
      expect(archived.state.reads).toBe(0);

      const unlinked = makeHarness();
      const unlinkedSweep = yield* unlinked.start;
      unlinked.state.read = { _tag: "not-linked" };
      yield* unlinkedSweep;
      expect(unlinked.watches()).toEqual([]);

      const replaced = makeHarness();
      const replacedSweep = yield* replaced.start;
      replaced.state.read = {
        _tag: "read",
        url: "https://acme.slack.com/archives/C1/p2000200",
        snapshot: slackSnapshot(thread(ROOT)),
      };
      yield* replacedSweep;
      expect(replaced.watches()).toEqual([]);
      expect([...archived.dispatched, ...unlinked.dispatched, ...replaced.dispatched]).toEqual([]);
    }),
  );

  it.effect("keeps a watch while its integration is turned off", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const harnessSweep = yield* harness.start;
      harness.state.read = { _tag: "off" };
      yield* harnessSweep;
      expect(harness.watches()).toHaveLength(1);
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("gives up after repeated read failures and says so", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const harnessSweep = yield* harness.start;
      harness.state.read = "fail";
      for (let attempt = 0; attempt < 7; attempt += 1) {
        yield* harnessSweep;
        yield* TestClock.adjust("1 minute");
      }
      expect(harness.watches()).toHaveLength(1);
      yield* harnessSweep;
      expect(harness.watches()).toEqual([]);
      const [wake] = wakes(harness.dispatched);
      expect(wake?.notification).toMatchObject({ outcome: "failed" });
      expect(wake?.text).toContain("failed to read it 8 times in a row (Slack is down)");
    }),
  );

  it.effect("ends the watch when the thread turns the wake away", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const harnessSweep = yield* harness.start;
      harness.state.rejectWake = true;
      harness.setThread(thread(ROOT, message(1, "Ben", "Ship it")));
      yield* harnessSweep;
      expect(harness.watches()).toEqual([]);
    }),
  );
});
