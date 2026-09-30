import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  composerThreadReferenceItems,
  DEFAULT_THREAD_ATTACH_PICKER_VIEW,
  groupThreadAttachPickerItems,
} from "./composerThreadReferences";

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
    createdAt: updatedAt,
    updatedAt,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
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

  it("combines project and provider filters with title search before limiting results", () => {
    const secondProject = ProjectId.make("project-2");
    const claude = { instanceId: ProviderInstanceId.make("claude-personal"), model: "sonnet" };
    const items = composerThreadReferenceItems({
      threads: [
        thread("a", "Login in main project", "2026-09-03", { modelSelection: claude }),
        thread("b", "Login with Codex", "2026-09-04", { projectId: secondProject }),
        thread("c", "Unrelated Claude work", "2026-09-05", {
          projectId: secondProject,
          modelSelection: claude,
        }),
        thread("d", "Login with Claude", "2026-09-02", {
          projectId: secondProject,
          modelSelection: claude,
        }),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set(),
      query: "login",
      limit: 1,
      view: {
        ...DEFAULT_THREAD_ATTACH_PICKER_VIEW,
        projectIds: [secondProject],
        providerInstanceIds: [claude.instanceId],
      },
    });
    expect(items.map((item) => item.threadId)).toEqual(["d"]);
  });

  it.each([
    ["updated", ["a", "b", "c"]],
    ["newest", ["c", "b", "a"]],
    ["oldest", ["a", "b", "c"]],
    ["title", ["b", "c", "a"]],
  ] as const)("sorts picker results by %s before applying the limit", (sort, expected) => {
    const items = composerThreadReferenceItems({
      threads: [
        thread("a", "Zebra", "2026-09-03", { createdAt: "2026-09-01" }),
        thread("b", "Alpha", "2026-09-02", { createdAt: "2026-09-02" }),
        thread("c", "Middle", "2026-09-01", { createdAt: "2026-09-03" }),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set(),
      query: "",
      limit: 2,
      view: { ...DEFAULT_THREAD_ATTACH_PICKER_VIEW, sort },
    });
    expect(items.map((item) => item.threadId)).toEqual(expected.slice(0, 2));
  });

  it("keeps tabs together under their parent and orders groups by their best matching tab", () => {
    const items = composerThreadReferenceItems({
      threads: [
        thread("parent", "Improve authentication", "2026-09-01"),
        thread("child", "Review redirect handling", "2026-09-04"),
        thread("other", "Independent work", "2026-09-03"),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set(),
      query: "",
      limit: 50,
      tabMemberships: ["parent", "child"].map((id) => ({
        threadId: ThreadId.make(id),
        groupId: ThreadId.make("parent"),
      })),
    });
    expect(
      groupThreadAttachPickerItems(items).map((group) => ({
        id: group.id,
        title: group.parentTitle,
        project: group.projectTitle,
        tabs: group.entries.map((entry) => entry.threadId),
      })),
    ).toEqual([
      {
        id: "parent",
        title: "Improve authentication",
        project: "t3code",
        tabs: ["parent", "child"],
      },
      { id: "other", title: null, project: "t3code", tabs: ["other"] },
    ]);
  });

  it("finds sibling tabs by their parent's title even when the current parent tab is excluded", () => {
    const claude = { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" };
    const items = composerThreadReferenceItems({
      threads: [
        thread("parent", "Improve authentication", "2026-09-01"),
        thread("child", "Review redirect handling", "2026-09-04", { modelSelection: claude }),
        thread("other-tab", "Implement login", "2026-09-03"),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set([ThreadId.make("parent")]),
      query: "AUTHENTICATION",
      limit: 50,
      view: { ...DEFAULT_THREAD_ATTACH_PICKER_VIEW, providerInstanceIds: [claude.instanceId] },
      tabMemberships: ["parent", "child", "other-tab"].map((id) => ({
        threadId: ThreadId.make(id),
        groupId: ThreadId.make("parent"),
      })),
    });
    expect(items.map((entry) => [entry.threadId, entry.parentThreadTitle])).toEqual([
      ["child", "Improve authentication"],
    ]);
    expect(groupThreadAttachPickerItems(items)[0]?.id).toBe("parent");
  });

  it("promotes the first open tab's title when the original tab is closed or missing", () => {
    const items = composerThreadReferenceItems({
      threads: [
        thread("parent", "Closed original", "2026-09-01", { archivedAt: "2026-09-02" }),
        thread("child", "First open tab", "2026-09-03"),
        thread("later", "Most active tab", "2026-09-04"),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set(),
      query: "",
      limit: 50,
      tabMemberships: ["parent", "missing", "child", "later"].map((id) => ({
        threadId: ThreadId.make(id),
        groupId: ThreadId.make("parent"),
      })),
    });
    expect(
      groupThreadAttachPickerItems(items).map((group) => ({
        title: group.parentTitle,
        tabs: group.entries.map((entry) => entry.threadId),
      })),
    ).toEqual([{ title: "First open tab", tabs: ["later", "child"] }]);
  });

  it("resolves parent labels from the target environment, including live renames", () => {
    const items = composerThreadReferenceItems({
      threads: [
        thread("parent", "Parent in other environment", "2026-09-05", {
          environmentId: EnvironmentId.make("env-2"),
        }),
        thread("parent", "Renamed parent", "2026-09-01"),
        thread("child", "Review", "2026-09-04"),
      ],
      projects,
      environmentId,
      excludeThreadIds: new Set([ThreadId.make("parent")]),
      query: "renamed",
      limit: 50,
      tabMemberships: ["parent", "child"].map((id) => ({
        threadId: ThreadId.make(id),
        groupId: ThreadId.make("parent"),
      })),
    });
    expect(items.map((entry) => entry.parentThreadTitle)).toEqual(["Renamed parent"]);
  });
});
