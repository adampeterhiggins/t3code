import type { ChatThreadMessage, LinearIssueContext, SlackThreadContext } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  baselineOf,
  diffLinkSnapshot,
  linearSnapshot,
  linkWatchMessage,
  slackSnapshot,
} from "./linkWatchSnapshot.ts";

const message = (index: number, authorName: string, text: string): ChatThreadMessage => ({
  index,
  authorName,
  avatarUrl: null,
  postedAt: `2026-10-22T10:0${index}:00.000Z`,
  text,
  files: [],
  linked: index === 0,
});

const slackThread = (messages: ReadonlyArray<ChatThreadMessage>): SlackThreadContext => ({
  teamId: "T1",
  channelId: "C1",
  channelLabel: "#eng",
  ts: "1.000100",
  threadTs: null,
  url: "https://acme.slack.com/archives/C1/p1000100",
  authorName: "Ada",
  title: "Review the plan",
  replyCount: messages.length - 1,
  scope: "thread",
  markdown: messages.map((entry) => `${entry.authorName}: ${entry.text}`).join("\n"),
  messages: [...messages],
});

const linearIssue = (overrides: Partial<LinearIssueContext> = {}): LinearIssueContext => ({
  id: "uuid-1",
  identifier: "ENG-1",
  title: "Fix the cache",
  url: "https://linear.app/acme/issue/ENG-1",
  stateName: "Todo",
  stateType: "unstarted",
  stateColor: "#ccc",
  priorityLabel: null,
  assigneeName: null,
  updatedAt: "2026-10-22T10:00:00.000Z",
  markdown: "# ENG-1\nFix the cache",
  ...overrides,
});

describe("diffLinkSnapshot", () => {
  it("reports nothing when a re-read shows the same thread", () => {
    const thread = slackThread([message(0, "Ada", "Review the plan")]);
    expect(diffLinkSnapshot(baselineOf(slackSnapshot(thread)), slackSnapshot(thread))).toBeNull();
  });

  it("reports new replies in order and edits to known ones", () => {
    const before = slackSnapshot(
      slackThread([message(0, "Ada", "Review the plan"), message(1, "Ben", "Looks fine")]),
    );
    const after = slackSnapshot(
      slackThread([
        message(0, "Ada", "Review the plan, please"),
        message(1, "Ben", "Looks fine"),
        message(3, "Ada", "Merging"),
        message(2, "Cy", "One question"),
      ]),
    );
    const change = diffLinkSnapshot(baselineOf(before), after);
    expect(change?.newMessages.map((entry) => entry.text)).toEqual(["One question", "Merging"]);
    expect(change?.editedMessages).toBe(1);
    expect(change?.bodyChanged).toBe(false);
  });

  it("reports an issue's status as a before and after, with its content", () => {
    const before = linearSnapshot(linearIssue());
    const after = linearSnapshot(
      linearIssue({ stateName: "Done", stateType: "completed", markdown: "# ENG-1\nDone" }),
    );
    expect(after.closed).toBe(true);
    expect(diffLinkSnapshot(baselineOf(before), after)).toEqual({
      fields: [{ label: "Status", from: "Todo", to: "Done" }],
      newMessages: [],
      editedMessages: 0,
      bodyChanged: true,
    });
  });

  it("reports a comment that changed only the content", () => {
    const before = linearSnapshot(linearIssue());
    const after = linearSnapshot(linearIssue({ markdown: "# ENG-1\nFix the cache\n> Ben: on it" }));
    expect(diffLinkSnapshot(baselineOf(before), after)).toMatchObject({
      fields: [],
      bodyChanged: true,
    });
  });
});

describe("linkWatchMessage", () => {
  const thread = slackThread([message(0, "Ada", "Review the plan"), message(1, "Ben", "Ship it")]);
  const snapshot = slackSnapshot(thread);
  const change = diffLinkSnapshot(
    baselineOf(slackSnapshot(slackThread([message(0, "Ada", "Review the plan")]))),
    snapshot,
  )!;

  it("lists who wrote what and says the watch continues", () => {
    const { text, notification } = linkWatchMessage({
      kind: "slack",
      url: thread.url,
      snapshot,
      change,
      outcome: "watching",
    });
    expect(text).toContain(`Update on the Slack thread "Review the plan" (${thread.url})`);
    expect(text).toContain("- 1 new message:\n  - Ben at 2026-10-22T10:01:00.000Z: Ship it");
    expect(text).toContain("unwatch_thread_link");
    expect(notification).toEqual({
      source: { kind: "monitor" },
      outcome: "updated",
      summary: "Slack thread Review the plan: 1 new message",
    });
  });

  it("says when the watch stopped", () => {
    const limit = linkWatchMessage({
      kind: "slack",
      url: thread.url,
      snapshot,
      change,
      outcome: "limit",
    });
    expect(limit.text).toContain("stopped watching after 20 updates");
    const closed = linkWatchMessage({
      kind: "linear",
      url: "https://linear.app/acme/issue/ENG-1",
      snapshot: linearSnapshot(linearIssue({ stateName: "Done", stateType: "completed" })),
      change: {
        fields: [{ label: "Status", from: "Todo", to: "Done" }],
        newMessages: [],
        editedMessages: 0,
        bodyChanged: false,
      },
      outcome: "closed",
    });
    expect(closed.text).toContain("- Status: Todo → Done");
    expect(closed.text).toContain("It is closed, so T3 Code stopped watching it.");
  });
});
