import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchComposerThreadItems } from "./composerThreadItems.ts";

const env = EnvironmentId.make("env-1");
const otherEnv = EnvironmentId.make("env-2");
const shell = (
  id: string,
  title: string,
  overrides: Partial<Parameters<typeof matchComposerThreadItems>[0]["shells"][number]> = {},
) => ({
  environmentId: env,
  id: ThreadId.make(id),
  projectId: ProjectId.make("project-1"),
  title,
  branch: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  ...overrides,
});

describe("matchComposerThreadItems", () => {
  it("lists the most recent threads for a bare @", () => {
    const items = matchComposerThreadItems({
      shells: Array.from({ length: 25 }, (_, index) =>
        shell(`t${index}`, `Thread ${index}`, {
          updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      ),
      environmentId: env,
      excludeThreadId: null,
      query: "  ",
    });
    expect(items).toHaveLength(20);
    expect(items[0]?.thread.threadId).toBe("t24");
  });

  it("matches titles within the environment, newest first, skipping self and archived", () => {
    const items = matchComposerThreadItems({
      shells: [
        shell("old", "Login flow", { updatedAt: "2026-01-01T00:00:00.000Z" }),
        shell("new", "Login redesign", { updatedAt: "2026-02-01T00:00:00.000Z" }),
        shell("self", "Login self"),
        shell("gone", "Login archived", { archivedAt: "2026-01-02T00:00:00.000Z" }),
        shell("foreign", "Login elsewhere", { environmentId: otherEnv }),
        shell("nope", "Unrelated"),
      ],
      environmentId: env,
      excludeThreadId: ThreadId.make("self"),
      query: "LOGIN",
    });
    expect(items.map((item) => item.thread.threadId)).toEqual(["new", "old"]);
    expect(items[0]).toMatchObject({ type: "thread", label: "Login redesign" });
  });

  it("describes each thread by its project and branch", () => {
    const items = matchComposerThreadItems({
      shells: [shell("a", "On a branch", { branch: "feat/login" }), shell("b", "Unknown project")],
      environmentId: env,
      excludeThreadId: null,
      query: "",
      projectTitles: new Map([[ProjectId.make("project-1"), "t3code"]]),
    });
    expect(items.map((item) => item.description)).toEqual(["t3code · feat/login", "t3code"]);
  });
});
