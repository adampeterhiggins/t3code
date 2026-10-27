import { AudioPreview } from "../files/AudioPreview";
import { onTestFinished } from "vite-plus/test";
import { stubGlobal } from "../../../test/render";
import {
  ApprovalRequestId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  RunAttemptId,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createRef, Profiler, StrictMode, type ComponentProps, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, fakeTimers, render } from "../../../test/render";
import { MessagesTimeline } from "./MessagesTimeline";
import { makeStreamingTimelineFixture } from "../../test-fixtures";
import { deriveTimelineEntriesFromVisibleTurnItems } from "../../session-logic";
import { remarkThoughtPreview } from "./TimelineWorkEntryRow.logic";
import { parseMarkdownWithMath } from "@t3tools/shared/markdownMath";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { collectThreadFindRanges } from "./threadFindHighlights";
import { toastManager } from "../ui/toast";
import type { CitedHistory } from "./citationProcedure";
import type { TimelineNavigation } from "./timelineViewport";
import { rememberTimelinePosition } from "./timelineScrollAnchoring";

const environmentQuery = vi.hoisted(() => ({
  error: "Pull request not found",
  data: null as unknown,
}));
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: environmentQuery.data,
    dataUpdatedAt: 0,
    error: environmentQuery.error,
    failure: null,
    isPending: false,
    isSuccess: false,
    refresh: () => {},
  })) as never,
}));

const audioAsset = vi.hoisted(() => ({ url: "" }));
vi.mock(import("~/assets/assetUrls"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useAssetUrlState: ((...args: Parameters<typeof actual.useAssetUrlState>) =>
      audioAsset.url
        ? { _tag: "Success", url: audioAsset.url }
        : actual.useAssetUrlState(...args)) as typeof actual.useAssetUrlState,
  };
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-03-17T19:12:28.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

// The timeline remembers scroll position and open disclosures per thread key,
// so every render gets a fresh thread.
function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: `environment-local:thread-${Math.random().toString(36).slice(2)}`,
    onOpenTurnDiff: () => {},
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    onRollbackCheckpoint: () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    onAnchorSizeChanged: () => {},
    contentInsetEndAdjustment: 0,
    emptyPlaceholderInset: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
  };
}

function message(
  text: string,
  overrides: Partial<Extract<Entry, { kind: "message" }>["message"]> = {},
  id = "message-1",
): Entry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role: "user",
      text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
      ...overrides,
    },
  };
}

async function renderElement(element: ReactElement, options: { router?: false } = {}) {
  const container = document.createElement("div");
  container.style.cssText = "height: 1200px; width: 900px; display: flex; flex-direction: column;";
  const screen = await render(element, { container, ...options });
  const buttons = (name: string | RegExp) =>
    [...container.querySelectorAll<HTMLElement>("button, [role=button]")].filter((button) => {
      const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
      return typeof name === "string" ? label === name : name.test(label);
    });
  return Object.assign(screen, {
    text: () => container.textContent ?? "",
    buttons,
    button: (name: string | RegExp) => {
      const [match] = buttons(name);
      if (!match) throw new Error(`Missing button: ${String(name)}`);
      return match;
    },
  });
}

function renderTimeline(entries: ReadonlyArray<Entry>, props: Partial<TimelineProps> = {}) {
  return renderElement(
    <MessagesTimeline {...baseProps()} timelineEntries={entries as Entry[]} {...props} />,
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function work(id: string, entry: Record<string, unknown>): Entry {
  return {
    id,
    kind: "work",
    createdAt: CREATED_AT,
    entry: { id, createdAt: CREATED_AT, ...entry },
  } as Entry;
}

function v2Item(type: string, fields: Record<string, unknown>) {
  const id = (fields.id as string | undefined) ?? type;
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: "thread-1",
    sourceItemId: id,
    item: {
      id,
      threadId: "thread-1",
      runId: "run-1",
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: {},
      type,
      ...fields,
    },
  } as never;
}

describe("MessagesTimeline work rows", () => {
  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens a nested diff with %s without collapsing the tool row", async (_name, key) => {
    const onOpenTurnDiff = vi.fn();
    await using screen = await renderTimeline(
      [
        work("file-change-1", {
          label: "Updated src/index.ts",
          tone: "tool",
          itemType: "file_change",
          toolLifecycleStatus: "completed",
          projectedItem: v2Item("file_change", { id: "file-change-1", fileName: "src/index.ts" }),
        }),
      ],
      { onOpenTurnDiff },
    );
    const row = screen.container.querySelector<HTMLElement>('[data-v2-item-type="file_change"]')!;
    const press = async (target: HTMLElement) => {
      await act(async () => target.focus());
      await userEvent.keyboard(key);
    };
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await press(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const openDiff = screen.button("Open diff");
    await press(openDiff);
    expect(onOpenTurnDiff).toHaveBeenCalledWith("run-1", "src/index.ts");
    expect(onOpenTurnDiff).toHaveBeenCalledTimes(1);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    await press(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows dynamic tool input without cached output when the row is expanded", async () => {
    await using screen = await renderTimeline([
      work("tool-with-cached-output", {
        label: "Example tool",
        toolTitle: "Example tool",
        tone: "tool",
        itemType: "dynamic_tool",
        toolLifecycleStatus: "completed",
        toolData: {
          input: { query: "KEEP_TOOL_INPUT" },
          output: { text: "RAW_CACHED_TOOL_OUTPUT" },
        },
      }),
    ]);
    await click(screen.button("Example tool"));
    expect(screen.text()).toContain("KEEP_TOOL_INPUT");
    expect(screen.text()).not.toContain("RAW_CACHED_TOOL_OUTPUT");
    await click(screen.button("Example tool"));
    await vi.waitFor(() => expect(screen.text()).not.toContain("KEEP_TOOL_INPUT"));
  });

  it("expands and collapses a tool call through its header", async () => {
    await using screen = await renderTimeline([
      work("work-standalone", {
        toolCallId: "call-standalone",
        label: "Run lint",
        tone: "tool",
        itemType: "command_execution",
        command: "pnpm lint",
        toolLifecycleStatus: "completed",
      }),
    ]);
    const header = () => screen.container.querySelector<HTMLElement>("[aria-expanded]")!;
    expect(header().getAttribute("aria-expanded")).toBe("false");
    await click(header());
    expect(header().getAttribute("aria-expanded")).toBe("true");
    await click(header());
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });

  it("leads an unanswered question row with the question text", async () => {
    await using screen = await renderTimeline([
      work("question-work", {
        label: "User input requested",
        tone: "tool",
        questionAnswer: {
          requestId: ApprovalRequestId.make("question-request"),
          answers: {},
          questionTextById: { scope: "Which repository?" },
          attachmentsByQuestionId: {},
        },
      }),
    ]);
    const toggle = screen.button("Which repository?");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const before = screen.text().match(/Which repository\?/g)?.length ?? 0;
    expect(before).toBeGreaterThan(0);
    await click(toggle);
    expect(screen.text().match(/Which repository\?/g)?.length).toBe(before + 1);
  });

  it("shows an answered question with the answer on its own line", async () => {
    await using screen = await renderTimeline([
      work("question-work", {
        label: "User input requested",
        tone: "tool",
        questionAnswer: {
          requestId: ApprovalRequestId.make("question-request"),
          answers: { scope: "Blue" },
          questionTextById: { scope: "Which repository?" },
          attachmentsByQuestionId: {},
        },
      }),
    ]);
    const toggle = screen.button("Which repository?: Blue");
    const leaf = (text: string) =>
      [...toggle.querySelectorAll("span")].find(
        (element) => element.textContent === text && element.querySelector("span") === null,
      );
    const question = leaf("Which repository?");
    const answer = leaf("Blue");
    expect(question).toBeDefined();
    expect(answer).toBeDefined();
    expect(question?.parentElement).not.toBe(answer?.parentElement);
    expect(answer?.parentElement?.querySelector("svg")).not.toBeNull();
  });

  it("collapses settled tool runs behind a generated summary and names a failure", async () => {
    await using screen = await renderTimeline([
      work("work-1", {
        label: "Ran command",
        command: "vp lint",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
      }),
      work("work-2", {
        label: "Run lint",
        command: "vp test run",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "failed",
      }),
    ]);
    const summary = screen.button(/^Ran 2 commands/);
    expect(summary.getAttribute("aria-label")).toContain("tool call failed");
    expect(screen.text()).not.toContain("vp lint");
    await click(summary);
    await vi.waitFor(() => expect(screen.text()).toContain("vp lint"));
  });

  it("previews a collapsed group's tool calls on hover, each with its own nested preview", async () => {
    await using screen = await renderTimeline([
      work("work-1", {
        label: "Ran command",
        command: "vp lint",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
      }),
      work("work-2", {
        label: "Ran command",
        command: "vp test run",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
      }),
    ]);
    const summary = screen.button(/^Ran 2 commands/);
    await userEvent.hover(summary);
    const groupCard = page.getByRole("region", { name: "Tool calls" });
    await expect.element(groupCard.getByText("vp lint")).toBeVisible();
    await expect.element(page.getByText("2 commands", { exact: true })).toBeVisible();
    expect(summary.getAttribute("aria-expanded")).toBe("false");

    await userEvent.hover(groupCard.getByRole("button", { name: /vp test run/ }));
    await expect.element(page.getByText(/View output/)).toBeVisible();
    await expect.element(groupCard).toBeVisible();
  });

  it("keeps mixed work logs neutral after a later tool call succeeds", async () => {
    await using screen = await renderTimeline([
      work("work-failed", {
        label: "Run search",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "failed",
      }),
      work("work-info", { label: "Status updated", tone: "info" }),
      work("work-completed", {
        label: "Run tests",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
      }),
    ]);
    expect(screen.button("Ran 2 commands and received 1 update")).toBeDefined();
  });

  it("marks a failed tool inside an expanded work log", async () => {
    await using screen = await renderTimeline([
      work("work-info", { label: "Status updated", tone: "info" }),
      work("work-1", {
        label: "Glob",
        tone: "tool",
        toolLifecycleStatus: "failed",
        detail: "No files found",
      }),
    ]);
    await click(screen.button(/^Received 1 update/));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[aria-label="Tool call failed"]')).not.toBeNull(),
    );
  });

  it("renders context compaction entries in the normal work log", async () => {
    await using screen = await renderTimeline([
      work("work-1", { label: "Context compacted", tone: "info" }),
    ]);
    expect(screen.text()).toContain("Context compacted");
  });

  it("formats changed file paths from the workspace root", async () => {
    await using screen = await renderTimeline(
      [
        work("context-info", { label: "Session started", tone: "info" }),
        work("work-1", {
          label: "Updated files",
          tone: "tool",
          itemType: "file_change",
          toolLifecycleStatus: "completed",
          changedFiles: ["C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts"],
        }),
      ],
      { workspaceRoot: "C:/Users/mike/dev-stuff/t3code" },
    );
    await click(screen.button(/^Received 1 update/));
    await vi.waitFor(() => expect(screen.text()).toContain("t3code/apps/web/src/session-logic.ts"));
    expect(screen.text()).not.toContain(
      "C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts",
    );
    expect(
      screen.container.querySelector(
        '[aria-label="Full path: C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts"]',
      ),
    ).not.toBeNull();
  });

  it("renders T3 MCP dynamic tools with their pretty name", async () => {
    const item = {
      id: "tool-t3-thread-read",
      type: "dynamic_tool",
      toolName: "mcp__t3-code__t3_thread_read",
      input: { threadId: "thread-child" },
      output: { messages: [] },
    };
    await using screen = await renderTimeline([
      work("context-info", { label: "Session started", tone: "info" }),
      work(item.id, {
        runId: null,
        label: item.toolName,
        tone: "tool",
        itemType: item.type,
        toolTitle: item.toolName,
        toolLifecycleStatus: "completed",
        toolData: { input: item.input, output: item.output },
        structuredPayload: v2Item("dynamic_tool", item),
        projectedItem: v2Item("dynamic_tool", item),
      }),
    ]);
    await click(screen.button(/^Received 1 update/));
    await vi.waitFor(() => expect(screen.text()).toContain("Read a T3 thread"));
    expect(screen.text()).not.toContain("mcp__t3-code__t3_thread_read");
  });

  it("keeps a provider retry collapsed in the work log", async () => {
    const retryItem = {
      id: "provider-error",
      status: "running",
      title: "Provider retry",
      failure: {
        class: "transport_error",
        message: "The response stream disconnected.",
        code: "responseStreamDisconnected",
        retryable: true,
      },
      retry: { attempt: 2, maxAttempts: 5, retryDelayMs: null },
    };
    await using screen = await renderTimeline(
      [
        work("provider-error", {
          runId: "run-1",
          label: "Retrying provider (2/5)",
          detail: retryItem.failure.message,
          tone: "info",
          itemType: "error",
          toolLifecycleStatus: "inProgress",
          projectedItem: v2Item("error", retryItem),
        }),
      ],
      {
        isWorking: true,
        activeTurnInProgress: true,
        latestRun: {
          runId: RunId.make("run-1"),
          status: "running",
          startedAt: CREATED_AT,
          completedAt: null,
        },
      },
    );
    expect(screen.text()).toContain("Retrying provider (2/5)");
    expect(screen.text()).not.toContain("Structured details");
  });

  it.each([
    [
      "**Viewing image first** with *care*, ~~old~~ `code` and [context](https://example.com)",
      "Viewing image first with care, old code and context",
      1,
    ],
    ["first paragraph\n\nsecond paragraph", "first paragraph second paragraph", 0],
    ["- first\n- second", "first second", 0],
    ["first  \nsecond", "first second", 0],
    ["![image description](image.png)", "image description", 0],
    ["![](image.png)", "Thought", 0],
    ["---", "Thought", 0],
  ] as const)(
    "shows plain text for a V2 reasoning preview: %s",
    async (markdown, expected, strongCount) => {
      await using screen = await renderTimeline([
        work("reasoning-preview", {
          label: markdown,
          detail: markdown,
          tone: "thinking",
          itemType: "reasoning",
          toolLifecycleStatus: "completed",
        }),
      ]);
      const row = () =>
        screen.container.querySelector<HTMLElement>("[role=button][aria-expanded]")!;
      const preview = () => row().textContent!.replace(/\s+/g, " ");
      expect(preview()).toContain(expected);
      expect(screen.container.querySelectorAll("strong")).toHaveLength(0);
      await click(row());
      expect(screen.container.querySelectorAll("strong")).toHaveLength(strongCount);
      await click(row());
      expect(preview()).toContain(expected);
      await vi.waitFor(() => expect(screen.container.querySelectorAll("strong")).toHaveLength(0));
    },
  );
});
function setup({ scheduledTasks = [] as ReadonlyArray<{ id: string; title: string }> } = {}) {
  environmentQuery.data = { tasks: scheduledTasks };
}

const TASK_ID = ScheduledTaskId.make("task-1");
const AUTOMATION_PROMPT = "Triage the inbox\n\nLabel every new issue and close duplicates.";

describe("MessagesTimeline messages", () => {
  it("settles when equally long messages have very different rendered heights", async () => {
    const props = baseProps();
    const tall = message("a\n\n".repeat(6000), { role: "assistant" }, "tall");
    const earlier = Array.from({ length: 80 }, (_, index) =>
      message(
        `<details><summary>Reply ${index}</summary>${"compact ".repeat(2250)}</details>`,
        { role: "assistant" },
        `earlier-${index}`,
      ),
    );
    let nestedCommits = 0;
    let maxNestedCommits = 0;
    const onRender = (_id: string, phase: string) => {
      nestedCommits = phase === "nested-update" ? nestedCommits + 1 : 0;
      maxNestedCommits = Math.max(maxNestedCommits, nestedCommits);
    };
    const timeline = (entries: Entry[]) => (
      <Profiler id="timeline" onRender={onRender}>
        <MessagesTimeline {...props} timelineEntries={entries} />
      </Profiler>
    );
    await using screen = await renderElement(timeline([tall]));
    await vi.waitFor(() =>
      expect(props.listRef.current?.getState().sizeAtIndex(0)).toBeGreaterThan(100_000),
    );
    const viewport = props.listRef.current!.getScrollableNode()!;
    await act(() => {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
    });
    await screen.rerender(timeline([...earlier, tall]));
    await act(() => {
      void props.listRef.current!.scrollToIndex({ index: 0, animated: false });
    });
    await vi.waitFor(async () => {
      await act(() => {
        viewport.scrollTop = 0;
        viewport.dispatchEvent(new Event("scroll"));
      });
      expect(screen.text().includes("Reply 0")).toBe(true);
      expect(props.listRef.current!.getState().sizeAtIndex(0)).toBeGreaterThan(0);
    });
    expect(maxNestedCommits).toBeLessThan(20);
  });

  it("keeps the first and last message headings reachable from either end", async () => {
    setup();
    const props = baseProps();
    // Folded messages at both ends: their headings must not live inside the fold.
    const entries = Array.from({ length: 120 }, (_, index) =>
      index === 0
        ? message("First turn", { scheduledTaskId: TASK_ID }, "turn-0")
        : index === 119
          ? message(
              "Last turn",
              { createdBy: "agent", senderThreadId: ThreadId.make("thread-sender") },
              "turn-119",
            )
          : message(
              `Turn ${index}:\n\n${"x ".repeat(200)}`,
              { role: index % 2 === 0 ? "user" : "assistant" },
              `turn-${index}`,
            ),
    );
    await using screen = await renderElement(
      <MessagesTimeline {...props} timelineEntries={entries} />,
    );
    const headings = () => [...screen.container.querySelectorAll("h3")];
    const headingFor = (text: string) =>
      headings().find((heading) => heading.parentElement?.textContent?.includes(text));
    const viewport = props.listRef.current!.getScrollableNode()!;
    // A screen reader scrolls the heading it moves to into view.
    const expectHeadingInView = async (text: string, neighbour: string) => {
      await act(() => headingFor(text)!.scrollIntoView({ block: "start" }));
      await vi.waitFor(() => expect(screen.text()).toContain(neighbour));
      const row = headingFor(text)!.parentElement!.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      expect(row.top).toBeLessThan(view.bottom);
      expect(row.bottom).toBeGreaterThan(view.top);
    };

    await vi.waitFor(() => expect(screen.text()).toContain("Turn 118:"));
    expect(screen.text()).not.toContain("Turn 60:");
    // Wrapping follows DOM order, so the ends must also sit first and last.
    await vi.waitFor(() => {
      expect(headings()[0]).toBe(headingFor("First turn"));
      expect(headings().at(-1)).toBe(headingFor("Last turn"));
    });

    await expectHeadingInView("First turn", "Turn 1:");
    expect(headingFor("Last turn")).toBeDefined();
    await expectHeadingInView("Last turn", "Turn 118:");
  });

  it("keeps rows in item order after a reload or thread switch, before any timer runs", async () => {
    setup();
    // NVDA's browse mode keeps the first DOM order it reads, so a timer that sorts rows later is too late.
    using _timers = fakeTimers();
    const thread = (name: string) =>
      Array.from({ length: 120 }, (_, index) =>
        message(
          `${name} turn ${index}:\n\n${"x ".repeat(200)}`,
          { role: index % 2 === 0 ? "user" : "assistant" },
          `${name}-${index}`,
        ),
      );
    const props = baseProps();
    await using screen = await renderElement(
      <MessagesTimeline {...props} timelineEntries={thread("A")} />,
    );
    const turnsInDomOrder = () =>
      [...screen.container.querySelectorAll("h3")].map((heading) =>
        Number(/turn (\d+):/.exec(heading.parentElement?.textContent ?? "")?.[1]),
      );
    const expectItemOrder = () => {
      const turns = turnsInDomOrder();
      expect(turns).toEqual(turns.toSorted((a, b) => a - b));
    };

    expect(screen.text()).toContain("A turn 118:");
    expect(turnsInDomOrder()).toContain(0);
    expectItemOrder();

    await screen.rerender(
      <MessagesTimeline
        {...props}
        routeThreadKey={`${props.routeThreadKey}-other`}
        timelineEntries={thread("B")}
      />,
    );
    expect(screen.text()).toContain("B turn 118:");
    expect(screen.text()).not.toContain("A turn");
    expectItemOrder();
  });

  it("puts rows back in item order soon after a continuous scroll stops", async () => {
    setup();
    const props = baseProps();
    await using screen = await renderElement(
      <MessagesTimeline
        {...props}
        timelineEntries={Array.from({ length: 120 }, (_, index) =>
          message(
            `Turn ${index}:\n\n${"x ".repeat(200)}`,
            { role: index % 2 === 0 ? "user" : "assistant" },
            `turn-${index}`,
          ),
        )}
      />,
    );
    await vi.waitFor(() => expect(screen.text()).toContain("Turn 118:"));
    using _timers = fakeTimers();
    const turnsInDomOrder = () =>
      [...screen.container.querySelectorAll("h3")].map((heading) =>
        Number(/Turn (\d+):/.exec(heading.parentElement?.textContent ?? "")?.[1]),
      );
    const viewport = props.listRef.current!.getScrollableNode()!;

    const scroll = async (by: number) => {
      for (let step = 0; step < 40; step++) {
        await act(() => {
          viewport.scrollTop += by;
          viewport.dispatchEvent(new Event("scroll"));
          vi.advanceTimersByTime(16);
        });
      }
      // Wrapping right after a scroll must still reach the first and last message.
      expect(turnsInDomOrder()[0]).toBe(0);
      expect(turnsInDomOrder().at(-1)).toBe(119);
    };

    await act(() => {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(300);
    });
    await scroll(300);
    expect(turnsInDomOrder().filter((turn) => turn > 0 && turn < 100).length).toBeGreaterThan(0);
    await scroll(-300);

    await act(() => vi.advanceTimersByTime(300));
    const turns = turnsInDomOrder();
    expect(turns).toEqual(turns.toSorted((a, b) => a - b));
  });

  it("preserves XML-like tags and comparisons in user messages as text", async () => {
    const source = [
      'Without reading a file, do you have <global-agent-instructions scope="workspace">',
      'Before <nested data-value="a&b">inside</nested> after',
      "</global-agent-instructions> in your context?",
      "Comparison: 2 < 3 and 5 > 4.",
    ];
    await using screen = await renderTimeline([message(source.join("\n"))]);
    for (const line of source) expect(screen.text()).toContain(line);
    expect(screen.container.querySelector("global-agent-instructions, nested")).toBeNull();
  });

  it("renders unsafe user HTML as inert source text", async () => {
    const source =
      '<script>globalThis.__t3Xss = 1</script><img src="x" onerror="globalThis.__t3Xss = 2">';
    await using screen = await renderTimeline([message(source)]);
    expect(screen.text()).toContain(source);
    expect(screen.container.querySelector("script, img")).toBeNull();
    expect((globalThis as { __t3Xss?: number }).__t3Xss).toBeUndefined();
  });

  it("previews a sent skill chip on hover", async () => {
    const record = {
      version: 1,
      kind: "skill",
      contextId: ComposerContextId.make("skill-eod"),
      label: "EOD brief",
      name: "eod-brief",
    } as const;
    const reference = formatComposerContextReference(record);
    await using screen = await renderTimeline([
      message(`Run ${reference}`, { context: { version: 1, records: [record] } }),
    ]);
    await userEvent.hover(screen.button(/EOD brief/));
    await expect
      .element(page.getByText("No description is available for this skill."))
      .toBeVisible();
  });

  it("forks a user message into a new tab only where tabs exist", async () => {
    const onForkFromMessage = vi.fn();
    {
      await using screen = await renderTimeline([message("Try this")], { onForkFromMessage });
      await click(screen.button("Fork into new tab"));
      expect(onForkFromMessage).toHaveBeenCalledWith(MessageId.make("message-1"));
    }
    await using screen = await renderTimeline([message("Try this")]);
    expect(screen.buttons("Fork into new tab")).toHaveLength(0);
  });

  it("attaches a subagent to its parent chat from the Subagent of divider", async () => {
    const onAttach = vi.fn();
    await using screen = await renderTimeline([message("Work")], {
      parentThreadLink: {
        threadId: "thread-parent" as never,
        title: "Parent",
        handle: "researcher",
        onAttach,
      },
    });
    expect(screen.text()).toContain("@researcher");
    await click(screen.button("Attach to parent chat"));
    expect(onAttach).toHaveBeenCalledOnce();
  });

  it("renders sanitized raw HTML in assistant messages", async () => {
    await using screen = await renderTimeline([
      message(
        [
          '<details onclick="globalThis.__t3Xss = 1">',
          "<summary>Safe details</summary>",
          "<script>globalThis.__t3Xss = 2</script>",
          '<img src="x" onerror="globalThis.__t3Xss = 3">',
          '<a href="javascript:globalThis.__t3Xss = 4">Unsafe link</a>',
          "</details>",
        ].join(""),
        { role: "assistant" },
      ),
    ]);
    expect(screen.container.querySelector("[data-markdown-details]")?.textContent).toContain(
      "Safe details",
    );
    expect(screen.text()).not.toContain("<details");
    expect(screen.container.querySelector("script, [onclick], [onerror]")).toBeNull();
    expect(screen.container.innerHTML).not.toContain("javascript:");
    await click(screen.button("Safe details"));
    expect((globalThis as { __t3Xss?: number }).__t3Xss).toBeUndefined();
  });
});

const CITATION_REQUEST = {
  key: "activation-1",
  citation: {
    version: 1,
    environmentId: ENVIRONMENT_ID,
    threadId: ThreadId.make("thread-cited"),
    messageId: MessageId.make("cited"),
    text: "the cited answer",
    start: 0,
    end: 16,
    prefix: "",
    suffix: "",
  },
} satisfies NonNullable<TimelineProps["citationRequest"]>;

describe("MessagesTimeline citations", () => {
  it("lands a citation present at mount under StrictMode", async () => {
    await using _screen = await renderElement(
      <StrictMode>
        <MessagesTimeline
          {...baseProps()}
          timelineEntries={[
            message("A question", {}, "question"),
            message("the cited answer", { role: "assistant" }, "cited"),
          ]}
          citationRequest={CITATION_REQUEST}
          citationHistory={{ _tag: "found" }}
        />
      </StrictMode>,
      // The test router mounts route content without StrictMode's effect replay.
      { router: false },
    );
    // StrictMode replays effect cleanups on mount; the activation must survive them.
    await vi.waitFor(() =>
      expect(document.querySelector("[data-citation-highlighted]")?.textContent).toContain(
        "the cited answer",
      ),
    );
  });

  it("opens the superseded attempt that folds the cited response", async () => {
    const runId = RunId.make("run-steered");
    const attempt = (id: string, ordinal: number, status: "superseded" | "running") => ({
      id: RunAttemptId.make(id),
      runId,
      attemptOrdinal: ordinal,
      rootNodeId: `node-${id}` as never,
      status,
      completedAt: null,
    });
    const superseded = attempt("attempt-1", 1, "superseded");
    const active = attempt("attempt-2", 2, "running");
    const inAttempt = (entry: Entry, entryAttempt: typeof superseded): Entry => ({
      ...entry,
      attempt: entryAttempt,
    });
    await using _screen = await renderTimeline(
      [
        inAttempt(message("Build it", { runId }, "question"), superseded),
        inAttempt(message("the cited answer", { role: "assistant", runId }, "cited"), superseded),
        inAttempt(message("Change direction", { runId }, "steer"), active),
        inAttempt(message("Current response", { role: "assistant", runId }, "current"), active),
      ],
      {
        latestRun: { runId, status: "running", startedAt: CREATED_AT, completedAt: null },
        citationRequest: CITATION_REQUEST,
        citationHistory: { _tag: "found" },
      },
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-citation-highlighted]")?.textContent).toContain(
        "the cited answer",
      ),
    );
  });

  it("waits for cited history to load before giving up on a response outside the window", async () => {
    using toast = vi.spyOn(toastManager, "add");
    const props = baseProps();
    const citationRequest = CITATION_REQUEST;
    const recent = message("A recent question", {}, "recent");
    const timeline = (entries: Entry[], citationHistory: CitedHistory) => (
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        citationRequest={citationRequest}
        citationHistory={citationHistory}
      />
    );
    await using screen = await renderElement(timeline([recent], { _tag: "loading" }));
    await expect.element(screen.getByText("A recent question")).toBeVisible();

    await screen.rerender(
      timeline([message("the cited answer", { role: "assistant" }, "cited"), recent], {
        _tag: "found",
      }),
    );
    await expect.element(screen.getByText("the cited answer")).toBeVisible();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("MessagesTimeline automation prompts", () => {
  it("folds an automation prompt into a bubble titled by its task", async () => {
    setup({ scheduledTasks: [{ id: TASK_ID, title: "Nightly triage" }] });
    await using screen = await renderTimeline([
      message(AUTOMATION_PROMPT, { scheduledTaskId: TASK_ID }),
    ]);
    const row = screen.button(/^Automation/);
    expect(row.textContent).toContain("Nightly triage");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.text()).not.toContain("close duplicates");

    await click(row);
    expect(screen.text()).toContain("Label every new issue and close duplicates.");
    const link = [...screen.container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Open automation",
    );
    expect(link?.getAttribute("href")).toContain(`taskId=${TASK_ID}`);
    expect(screen.buttons(/copy/i)).not.toHaveLength(0);
  });

  it("falls back to the prompt's first line without a task title", async () => {
    setup();
    await using screen = await renderTimeline([
      message(AUTOMATION_PROMPT, { scheduledTaskId: TASK_ID }),
    ]);
    expect(screen.button(/^Automation/).textContent).toContain("Triage the inbox");
  });

  it("leaves ordinary user messages as full bubbles", async () => {
    setup();
    await using screen = await renderTimeline([message(AUTOMATION_PROMPT)]);
    expect(screen.buttons(/^Automation/)).toHaveLength(0);
    expect(screen.text()).toContain("Label every new issue and close duplicates.");
  });

  it("reveals a find match beyond the folded automation prompt's initial viewport", async () => {
    setup();
    const prompt = `${"Inspect the next item.\n\n".repeat(16)}Close duplicates.`;
    await using screen = await renderTimeline([message(prompt, { scheduledTaskId: TASK_ID })], {
      findExpanded: true,
      findQuery: "duplicates",
      activeFindMatch: { entryId: "entry-message-1", runId: null, occurrence: 0 },
    });
    await vi.waitFor(() =>
      expect(screen.button(/^Automation/).getAttribute("aria-expanded")).toBe("true"),
    );
    const { range } = collectThreadFindRanges(screen.container, "duplicates")[0]!;
    const details = screen.container.querySelector("[data-thread-find-text]")!;
    expect(range.getBoundingClientRect().top - details.getBoundingClientRect().top).toBeGreaterThan(
      384,
    );
    expect(range.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      details.getBoundingClientRect().bottom,
    );
  });

  it("shows edit-from-here once an automation prompt is expanded", async () => {
    setup();
    const runId = RunId.make("run-1");
    await using screen = await renderTimeline(
      [
        message(
          AUTOMATION_PROMPT,
          { scheduledTaskId: TASK_ID, runId, inputIntent: "turn_start" },
          "user-1",
        ),
        message("Done", { role: "assistant", runId }, "assistant-1"),
      ],
      {
        supportsConversationRollback: true,
        threadStartCheckpointReady: true,
        turnDiffSummaries: [
          {
            runId,
            checkpointTurnCount: 1,
            checkpointRef: "checkpoint-1" as never,
            status: "ready",
            files: [],
            assistantMessageId: MessageId.make("assistant-1"),
            completedAt: CREATED_AT,
          },
        ],
      },
    );
    expect(screen.buttons("Edit from here")).toHaveLength(0);
    await click(screen.button(/^Automation/));
    expect(screen.buttons("Edit from here")).toHaveLength(1);
  });
});

const SENDER_THREAD_ID = ThreadId.make("thread-sender");
const AGENT_MESSAGE = "Review finished\n\nThe migration drops the index before backfilling it.";

describe("MessagesTimeline agent messages", () => {
  it("folds a message from another agent into a one-line preview", async () => {
    setup();
    const onOpenThread = vi.fn();
    await using screen = await renderTimeline(
      [message(AGENT_MESSAGE, { createdBy: "agent", senderThreadId: SENDER_THREAD_ID })],
      { onOpenThread },
    );
    const row = screen.button(/^Agent/);
    expect(row.textContent).toContain("Review finished");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.text()).not.toContain("drops the index");
    expect(screen.buttons("Open thread")).toHaveLength(0);

    await click(row);
    expect(screen.text()).toContain("The migration drops the index before backfilling it.");
    await click(screen.button("Open thread"));
    expect(onOpenThread).toHaveBeenCalledWith(SENDER_THREAD_ID);

    await click(screen.button(/^Agent/));
    expect(screen.text()).not.toContain("drops the index");
  });

  it("leaves messages sent by T3 Code as full bubbles", async () => {
    setup();
    await using screen = await renderTimeline([
      message(AGENT_MESSAGE, { createdBy: "agent", creationSource: "server" }),
    ]);
    expect(screen.buttons(/^Agent/)).toHaveLength(0);
    expect(screen.text()).toContain("drops the index");
  });

  it("reveals a find match inside a folded agent message", async () => {
    setup();
    const text = `${"Checked the next file.\n\n".repeat(16)}The migration drops the index.`;
    await using screen = await renderTimeline(
      [message(text, { createdBy: "agent", senderThreadId: SENDER_THREAD_ID })],
      {
        findExpanded: true,
        findQuery: "drops the index",
        activeFindMatch: { entryId: "entry-message-1", runId: null, occurrence: 0 },
      },
    );
    await vi.waitFor(() =>
      expect(screen.button(/^Agent/).getAttribute("aria-expanded")).toBe("true"),
    );
    const { range } = collectThreadFindRanges(screen.container, "drops the index")[0]!;
    const body = screen.container.querySelector("[data-user-message-body]")!;
    expect(range.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(range.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      body.getBoundingClientRect().bottom,
    );
  });
});

describe("MessagesTimeline attachments", () => {
  it.each(["loadedmetadata", "loadeddata", "canplay"])(
    "plays audio with unknown duration after %s and updates the total later",
    async (readyEvent) => {
      const onOpen = vi.fn();
      const preview = (failed = false) => (
        <AudioPreview
          compact
          src="data:audio/webm;base64,"
          name="recording.webm"
          failed={failed}
          onOpen={onOpen}
        />
      );
      await using screen = await renderElement(preview());
      const audio = screen.container.querySelector("audio")!;
      const duration = vi.spyOn(audio, "duration", "get").mockReturnValue(Infinity);
      const play = vi.spyOn(audio, "play").mockResolvedValue();
      expect(screen.button("Loading recording.webm")).toHaveProperty("disabled", true);
      await act(() => audio.dispatchEvent(new Event(readyEvent)));
      expect(screen.button("Play recording.webm")).toHaveProperty("disabled", false);
      expect(screen.text()).toContain("0:00");
      expect(screen.text()).not.toContain("/");
      await click(screen.button("Play recording.webm"));
      expect(play).toHaveBeenCalledOnce();
      await act(() => {
        vi.spyOn(audio, "currentTime", "get").mockReturnValue(3);
        audio.dispatchEvent(new Event("play"));
        audio.dispatchEvent(new Event("timeupdate"));
      });
      expect(screen.button("Pause recording.webm")).toHaveProperty("disabled", false);
      expect(screen.text()).toContain("0:03");
      const progress = screen.container.querySelector<HTMLElement>("span[aria-hidden]")!;
      expect(progress.style.width).toBe("0%");
      await act(() => {
        duration.mockReturnValue(10);
        audio.dispatchEvent(new Event("durationchange"));
      });
      expect(screen.text()).toContain("0:03 / 0:10");
      expect(progress.style.width).toBe("30%");
      await act(() => {
        duration.mockReturnValue(NaN);
        audio.dispatchEvent(new Event("durationchange"));
      });
      expect(screen.text()).not.toContain("/");
      expect(progress.style.width).toBe("0%");
      expect(screen.button("Pause recording.webm")).toHaveProperty("disabled", false);
      await screen.rerender(preview(true));
      expect(screen.text()).toContain("Unavailable");
      await click(screen.button("Audio unavailable. Open recording.webm"));
      expect(onOpen).toHaveBeenCalledOnce();
    },
  );

  it.each(["pause", "error"])("unpins audio after %s", async (event) => {
    const NativeObserver = IntersectionObserver;
    using _observer = stubGlobal(
      "IntersectionObserver",
      class extends NativeObserver {
        constructor(
          private readonly notify: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          super(notify, options);
        }
        override observe(target: Element) {
          this.notify([{ target, isIntersecting: true } as IntersectionObserverEntry], this);
        }
      },
    );
    const src =
      "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";
    audioAsset.url = src;
    onTestFinished(() => {
      audioAsset.url = "";
    });
    const props = baseProps();
    await using screen = await renderTimeline(
      [
        // The first message row is always mounted, so the recordings go in the second.
        message("Start of the thread.", { role: "user" }, "opening"),
        message(
          "Two recordings.",
          {
            attachments: ["one", "two"].map((name) => ({
              type: "file",
              id: `attachment-${name}`,
              name: `${name}.wav`,
              mimeType: "audio/wav",
              sizeBytes: 45,
              previewUrl: src,
            })),
          },
          "audio",
        ),
        ...Array.from({ length: 40 }, (_, index) =>
          message("Conversation history. ".repeat(40), { role: "user" }, `history-${index}`),
        ),
      ],
      props,
    );
    screen.container.style.height = "600px";
    screen.container.scrollIntoView({ block: "start" });
    await vi.waitFor(
      async () => {
        await act(() => {
          void props.listRef.current?.scrollToIndex({ index: 1, animated: false });
        });
        expect(screen.container.querySelectorAll("audio")).toHaveLength(2);
      },
      { timeout: 5000 },
    );
    const [one, two] = [...screen.container.querySelectorAll("audio")];
    await act(async () => {
      vi.spyOn(one!, "paused", "get").mockReturnValue(false);
      vi.spyOn(two!, "paused", "get").mockReturnValue(false);
      one!.dispatchEvent(new Event("play"));
      two!.dispatchEvent(new Event("play"));
    });
    await vi.waitFor(async () => {
      await act(() => {
        void props.listRef.current!.scrollToEnd({ animated: false });
      });
      const scroll = props.listRef.current!.getScrollableNode()!;
      expect(scroll.scrollTop).toBeGreaterThan(5000);
    });
    expect(one!.isConnected).toBe(true);
    expect(two!.isConnected).toBe(true);
    await act(async () => {
      vi.spyOn(one!, "paused", "get").mockReturnValue(true);
      one!.dispatchEvent(new Event("pause"));
    });
    expect(two!.isConnected).toBe(true);
    await act(async () => {
      if (event === "pause") vi.spyOn(two!, "paused", "get").mockReturnValue(true);
      two!.dispatchEvent(new Event(event));
    });
    await act(() => {
      void props.listRef.current!.scrollToIndex({ index: 20, animated: false });
    });
    await vi.waitFor(() => expect(one!.isConnected).toBe(false));
  });
});

describe("MessagesTimeline thread find", () => {
  // Opening find is navigation; on a list already showing the thread the open
  // action navigates, so the list itself releases follow only when it starts
  // showing a thread whose find is already open.
  function renderObserved() {
    const navigations: TimelineNavigation[] = [];
    const base = baseProps();
    const element = (next: Partial<TimelineProps>) => (
      <MessagesTimeline
        {...base}
        timelineEntries={[message("Where is the sidebar fix?")]}
        onViewportAttach={(viewport) =>
          viewport.subscribe((navigation) => navigations.push(navigation))
        }
        {...next}
      />
    );
    return { navigations, element };
  }
  const released = { source: "command", releasesFollow: true };

  it("releases follow once when it starts showing a thread whose find is open", async () => {
    setup();
    const { navigations, element } = renderObserved();
    await using screen = await renderElement(element({}));
    expect(navigations).toEqual([]);

    const other = "environment-local:thread-find-open";
    await screen.rerender(element({ routeThreadKey: other, findOpen: true }));
    expect(navigations).toEqual([released]);
    await screen.rerender(element({ routeThreadKey: other, findOpen: false }));
    await screen.rerender(element({ routeThreadKey: other, findOpen: true }));
    expect(navigations).toEqual([released]);
  });

  it("releases follow once when it mounts on a thread whose find is open", async () => {
    setup();
    const { navigations, element } = renderObserved();
    await using screen = await renderElement(element({ findOpen: true }));
    await screen.rerender(element({ findOpen: true }));
    expect(navigations).toEqual([released]);
  });

  it("still restores the position of a thread it switches to whose find is open", async () => {
    setup();
    const base = baseProps();
    const other = "environment-local:thread-find-open-positioned";
    const replies = Array.from({ length: 40 }, (_, index) =>
      message(`Reply ${index}\n\n${"line\n\n".repeat(8)}`, { role: "assistant" }, `r-${index}`),
    );
    rememberTimelinePosition(
      other,
      { rowId: "entry-r-20", offsetWithinRow: 0, scrollOffset: 0, atEnd: false },
      false,
    );
    await using screen = await renderElement(
      <MessagesTimeline {...base} timelineEntries={[message("Short thread")]} />,
    );
    await screen.rerender(
      <MessagesTimeline
        {...base}
        routeThreadKey={other}
        timelineEntries={replies}
        liveFollowEnabled={false}
        findOpen
      />,
    );
    const viewport = base.listRef.current!.getScrollableNode()!;
    await vi.waitFor(() => {
      const row = screen.container.querySelector('[data-timeline-row-id="entry-r-20"]');
      expect(row).not.toBeNull();
      expect(
        Math.abs(row!.getBoundingClientRect().top - viewport.getBoundingClientRect().top),
      ).toBeLessThanOrEqual(2);
    });
  });
  it("reveals find's match, not the remembered row, on a thread it switches to", async () => {
    setup();
    const base = baseProps();
    const other = "environment-local:thread-find-open-match";
    const replies = Array.from({ length: 40 }, (_, index) =>
      message(
        `${index === 5 ? "Needle here" : `Reply ${index}`}\n\n${"line\n\n".repeat(8)}`,
        { role: "assistant" },
        `r-${index}`,
      ),
    );
    rememberTimelinePosition(
      other,
      { rowId: "entry-r-20", offsetWithinRow: 0, scrollOffset: 0, atEnd: false },
      false,
    );
    await using screen = await renderElement(
      <MessagesTimeline {...base} timelineEntries={[message("Short thread")]} />,
    );
    await screen.rerender(
      <MessagesTimeline
        {...base}
        routeThreadKey={other}
        timelineEntries={replies}
        liveFollowEnabled={false}
        findOpen
        findExpanded
        findQuery="Needle"
        activeFindMatch={{ entryId: "entry-r-5", runId: null, occurrence: 0 }}
      />,
    );
    const viewport = base.listRef.current!.getScrollableNode()!;
    await vi.waitFor(() => {
      const row = screen.container.querySelector('[data-timeline-row-id="entry-r-5"]');
      expect(row).not.toBeNull();
      const bounds = viewport.getBoundingClientRect();
      const top = row!.getBoundingClientRect().top;
      expect(top).toBeGreaterThanOrEqual(bounds.top);
      expect(top).toBeLessThan(bounds.bottom);
    });
  });
});

describe("compact reasoning math", () => {
  it("keeps formulas while flattening compact reasoning previews", () => {
    const tree = parseMarkdownWithMath("## Reasoning\n\nUse **norm** $|x|$ and \\[x^2\\]");
    remarkThoughtPreview("Reasoning")(tree);
    expect(tree.children.map((node) => node.type)).toEqual([
      "text",
      "inlineMath",
      "text",
      "inlineMath",
    ]);
    expect(tree.children.map((node) => ("value" in node ? node.value : null))).toEqual([
      "Reasoning Use norm ",
      "|x|",
      " and ",
      "x^2",
    ]);
  });
});

it("renders automatic compaction as one live divider that finishes with its reason and token delta", async () => {
  setup();
  const fixture = makeStreamingTimelineFixture();
  const prompt = fixture.visibleTurnItems[3]!;
  const assistant = fixture.visibleTurnItems[5]!;
  if (prompt.item.type !== "user_message" || assistant.item.type !== "assistant_message") {
    throw new Error("Expected streaming fixture messages");
  }
  const promptItem = prompt.item;
  const compaction = {
    ...assistant,
    item: {
      ...assistant.item,
      type: "compaction" as const,
      driver: null,
      beforeTokenCount: 899_000,
    },
  };
  const entries = (completed: boolean) =>
    deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: [
        {
          ...prompt,
          item: { ...promptItem, text: "/compact", idleCompaction: "beforeCacheExpires" },
        },
        {
          ...compaction,
          item: {
            ...compaction.item,
            status: completed ? "completed" : "running",
            afterTokenCount: completed ? 19_000 : undefined,
          },
        },
      ],
      optimisticMessages: [],
    });
  const props = baseProps();
  const ui = (completed: boolean) => (
    <MessagesTimeline
      {...props}
      timelineEntries={entries(completed)}
      isWorking={!completed}
      isCompacting={!completed}
      activeTurnInProgress={!completed}
      activeTurnStartedAt={fixture.time(5)}
      latestRun={{
        runId: fixture.runId,
        status: completed ? "completed" : "running",
        startedAt: fixture.time(5),
        completedAt: completed ? fixture.time(9) : null,
      }}
    />
  );
  const container = document.createElement("div");
  container.style.cssText = "height: 1200px; width: 900px; display: flex; flex-direction: column;";
  await using screen = await render(ui(false), { container });
  await expect
    .element(screen.getByRole("separator", { name: "Compacting before the cache expires…" }))
    .toBeVisible();
  expect(container.textContent).not.toContain("/compact");
  expect(container.textContent).not.toContain("Thinking");
  expect(container.textContent).not.toContain("Working");
  expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
  await screen.rerender(ui(true));
  await expect
    .element(
      screen.getByRole("separator", {
        name: "Context automatically compacted before cache expiry 899K → 19K tokens",
      }),
    )
    .toBeVisible();
  expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
  expect(container.textContent).not.toContain("Compacting before");
});
