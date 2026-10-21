import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appendCitationToPrompt, rankCitationDestinationThreads } from "./citationDestination";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

function shell(
  id: string,
  overrides: Partial<Record<keyof EnvironmentThreadShell, unknown>> = {},
): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: id,
    runtime: null,
    archivedAt: null,
    hiddenAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

const rank = (threads: EnvironmentThreadShell[], query = "") =>
  rankCitationDestinationThreads({
    threads,
    projectTitles: new Map([[projectId, "t3code"]]),
    environmentId,
    currentThreadId: ThreadId.make("source"),
    query,
  }).map((entry) => entry.thread.id);

describe("rankCitationDestinationThreads", () => {
  it("offers other live threads in the source environment, running ones first", () => {
    const threads = [
      shell("source"),
      shell("older", { updatedAt: "2026-09-01T00:00:00.000Z" }),
      shell("newer", { updatedAt: "2026-10-02T00:00:00.000Z" }),
      shell("running", {
        updatedAt: "2026-08-01T00:00:00.000Z",
        runtime: { status: "running", activeRunId: "run-1" },
      }),
      shell("archived", { archivedAt: "2026-10-03T00:00:00.000Z" }),
      shell("hidden", { hiddenAt: "2026-10-03T00:00:00.000Z" }),
      shell("elsewhere", { environmentId: EnvironmentId.make("env-2") }),
    ];

    expect(rank(threads)).toEqual(["running", "newer", "older"]);
  });

  it("matches the query against thread and project titles", () => {
    const threads = [shell("Fix WS reconnect backoff"), shell("Composer drafts sync")];

    expect(rank(threads, "reconn")).toEqual(["Fix WS reconnect backoff"]);
    expect(rank(threads, "T3CODE")).toHaveLength(2);
  });
});

describe("appendCitationToPrompt", () => {
  it("starts an empty prompt with the citation", () => {
    expect(appendCitationToPrompt("  ", "[quote](cite)")).toBe("[quote](cite) ");
  });

  it("keeps one space between the existing prompt and the citation", () => {
    expect(appendCitationToPrompt("Look at", "[quote](cite)")).toBe("Look at [quote](cite) ");
    expect(appendCitationToPrompt("Look at\n", "[quote](cite)")).toBe("Look at\n[quote](cite) ");
  });
});
