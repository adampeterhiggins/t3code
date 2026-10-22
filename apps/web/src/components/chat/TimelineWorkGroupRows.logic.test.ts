import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import { summarizeWorkGroupPreview, workEntryDurationMs } from "./TimelineWorkGroupRows.logic";

const at = (time: string) => DateTime.makeUnsafe(`2026-10-22T19:${time}.000Z`);

function call(
  id: string,
  fields: Partial<WorkLogEntry> & {
    item?: Record<string, unknown>;
  } = {},
): WorkLogEntry {
  const { item, ...entry } = fields;
  return {
    id,
    createdAt: "2026-10-22T19:12:00.000Z",
    label: id,
    tone: "tool",
    itemType: "command_execution",
    toolLifecycleStatus: "completed",
    ...(item
      ? {
          projectedItem: {
            item: { type: "command_execution", startedAt: null, completedAt: null, ...item },
          } as never,
        }
      : {}),
    ...entry,
  };
}

const notRunning = () => false;

describe("summarizeWorkGroupPreview", () => {
  it("spans the first start to the last completion and counts each kind", () => {
    const summary = summarizeWorkGroupPreview(
      [
        call("lint", { item: { startedAt: at("12:00"), completedAt: at("12:38") } }),
        call("read", {
          itemType: "dynamic_tool",
          requestKind: "file-read",
          item: { startedAt: at("12:40"), completedAt: at("12:41") },
        }),
        call("test", {
          toolLifecycleStatus: "failed",
          item: { startedAt: at("13:00"), completedAt: at("13:42") },
        }),
      ],
      notRunning,
    );
    expect(summary).toMatchObject({
      startedAt: "2026-10-22T19:12:00.000Z",
      completedAt: "2026-10-22T19:13:42.000Z",
      elapsedMs: 102_000,
      counts: ["2 commands", "1 read"],
      failedCount: 1,
      runningCount: 0,
      diff: null,
    });
  });

  it("leaves the end open while a call runs, without counting it as failed", () => {
    const running = call("test", {
      toolLifecycleStatus: "inProgress",
      item: { startedAt: at("13:00") },
    });
    const summary = summarizeWorkGroupPreview(
      [call("lint", { item: { startedAt: at("12:00"), completedAt: at("12:38") } }), running],
      (entry) => entry === running,
    );
    expect(summary).toMatchObject({ completedAt: null, elapsedMs: null, runningCount: 1 });
  });

  it("totals edit line counts only when the provider reported them", () => {
    const edit = (id: string, item: Record<string, unknown>) =>
      call(id, {
        itemType: "file_change",
        item: { type: "file_change", fileName: `${id}.ts`, ...item },
      });
    expect(
      summarizeWorkGroupPreview(
        [edit("a", { additions: 100, deletions: 30 }), edit("b", { additions: 20, deletions: 4 })],
        notRunning,
      )?.diff,
    ).toEqual({ additions: 120, deletions: 34 });
    expect(summarizeWorkGroupPreview([edit("a", {})], notRunning)?.diff).toBeNull();
  });

  it("has no elapsed time when no call was timed", () => {
    expect(summarizeWorkGroupPreview([call("a"), call("b")], notRunning)?.elapsedMs).toBeNull();
  });
});

describe("workEntryDurationMs", () => {
  it("needs both a start and a completion", () => {
    expect(
      workEntryDurationMs(
        call("a", { item: { startedAt: at("12:00"), completedAt: at("12:22") } }),
      ),
    ).toBe(22_000);
    expect(workEntryDurationMs(call("a", { item: { startedAt: at("12:00") } }))).toBeNull();
    expect(workEntryDurationMs(call("a"))).toBeNull();
  });
});
