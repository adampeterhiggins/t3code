import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { composerThreadReferenceItems } from "./composerThreadReferences";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

function thread(
  id: string,
  title: string,
  updatedAt: string,
  overrides: Partial<EnvironmentThreadShell> = {},
) {
  return {
    id: ThreadId.make(id),
    environmentId,
    projectId,
    title,
    updatedAt,
    archivedAt: null,
    ...overrides,
  } as EnvironmentThreadShell;
}

const projects = [{ id: projectId, environmentId, title: "t3code" } as EnvironmentProject];

describe("composerThreadReferenceItems", () => {
  const threads = [
    thread("a", "Fix login redirect", "2026-09-01T00:00:00.000Z"),
    thread("b", "Login copy tweaks", "2026-09-03T00:00:00.000Z"),
    thread("c", "Archived login work", "2026-09-04T00:00:00.000Z", {
      archivedAt: "2026-09-05T00:00:00.000Z",
    }),
    thread("d", "Login in other environment", "2026-09-04T00:00:00.000Z", {
      environmentId: EnvironmentId.make("env-2"),
    }),
    thread("e", "Current login thread", "2026-09-06T00:00:00.000Z"),
    thread("f", "Unrelated", "2026-09-07T00:00:00.000Z"),
  ];

  it("lists matching threads of this environment, newest first, without excluded ones", () => {
    const items = composerThreadReferenceItems({
      threads,
      projects,
      environmentId,
      excludeThreadIds: new Set([ThreadId.make("e")]),
      query: "LOGIN",
    });
    expect(items.map((item) => [item.threadId, item.description])).toEqual([
      ["b", "t3code"],
      ["a", "t3code"],
    ]);
  });

  it("shows only a few recent threads before anything is typed", () => {
    const items = composerThreadReferenceItems({
      threads,
      projects,
      environmentId,
      excludeThreadIds: new Set(),
      query: " ",
    });
    expect(items.map((item) => item.threadId)).toEqual(["f", "e", "b"]);
  });

  it("lets the attachment picker show more recent threads than the mention menu", () => {
    const items = composerThreadReferenceItems({
      threads: [
        ...threads,
        thread("g", "Sibling tab", "2026-09-08T00:00:00.000Z"),
        thread("h", "Another project", "2026-09-09T00:00:00.000Z", {
          projectId: ProjectId.make("project-2"),
        }),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set([ThreadId.make("e")]),
      query: "",
      limit: 50,
    });
    expect(items.map((item) => item.threadId)).toEqual(["h", "g", "f", "b", "a"]);
  });

  it("applies the picker limit after matching and sorting", () => {
    const threads = Array.from({ length: 60 }, (_, index) =>
      thread(`thread-${index}`, `Work ${index}`, new Date(index * 60_000).toISOString()),
    );
    const items = composerThreadReferenceItems({
      threads,
      projects,
      environmentId,
      excludeThreadIds: new Set([ThreadId.make("thread-59")]),
      query: "WORK",
      limit: 50,
    });
    expect(items).toHaveLength(50);
    expect(items[0]?.threadId).toBe("thread-58");
    expect(items.at(-1)?.threadId).toBe("thread-9");
  });
});
