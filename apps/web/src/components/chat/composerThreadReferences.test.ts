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
});
