import { ComposerContextId, ProjectId, type ScheduledTask } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import {
  automationRunBlocker,
  automationsForPicker,
  scheduledTaskPromptFromComposer,
} from "./scheduledTaskPicker.ts";

describe("automationsForPicker", () => {
  const projectId = ProjectId.make("project-a");
  const task = (
    overrides: Partial<Parameters<typeof automationsForPicker>[0][number]> & { title: string },
  ) => ({
    projectId,
    prompt: "",
    schedule: { type: "interval", everyMs: 60_000 } as ScheduledTask["schedule"],
    lastRunAt: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  });

  it("keeps the project's tasks, most recently run first and webhook tasks last", () => {
    const tasks = [
      task({
        title: "hook",
        schedule: { type: "webhook", signature: null },
        lastRunAt: "2026-10-02T00:00:00.000Z",
      }),
      task({ title: "never run, edited recently", updatedAt: "2026-09-20T00:00:00.000Z" }),
      task({ title: "ran yesterday", lastRunAt: "2026-10-19T00:00:00.000Z" }),
      task({ title: "other project", projectId: ProjectId.make("project-b") }),
    ];
    expect(automationsForPicker(tasks, projectId, "").map((entry) => entry.title)).toEqual([
      "ran yesterday",
      "never run, edited recently",
      "hook",
    ]);
  });

  it("matches the search against the title and the prompt", () => {
    const tasks = [
      task({ title: "Triage Sentry", prompt: "look at new errors" }),
      task({ title: "Dependency bumps", prompt: "Open PRs for outdated SENTRY packages" }),
      task({ title: "Release notes", prompt: "write them" }),
    ];
    expect(automationsForPicker(tasks, projectId, "  sentry ").map((entry) => entry.title)).toEqual(
      ["Triage Sentry", "Dependency bumps"],
    );
  });
});

describe("automationRunBlocker", () => {
  it("blocks webhook tasks and runs already in progress", () => {
    expect(
      automationRunBlocker({
        schedule: { type: "webhook", signature: null },
        lastRunStatus: "never",
      }),
    ).not.toBeNull();
    expect(
      automationRunBlocker({
        schedule: { type: "interval", everyMs: 60_000 },
        lastRunStatus: "running",
      }),
    ).not.toBeNull();
    expect(
      automationRunBlocker({
        schedule: { type: "fixed_time", timeOfDay: "09:00" },
        lastRunStatus: "failed",
      }),
    ).toBeNull();
  });
});

describe("scheduledTaskPromptFromComposer", () => {
  const chip = formatComposerContextReference({
    kind: "github-issue",
    contextId: ComposerContextId.make("github-issue_abc"),
    label: "#42 Flaky login",
  });

  it("keeps plain text as it is, with no note", () => {
    expect(scheduledTaskPromptFromComposer("  Summarise errors \n", 0)).toEqual({
      prompt: "Summarise errors",
      note: null,
    });
  });

  it("turns context chips into their labels and says so", () => {
    const result = scheduledTaskPromptFromComposer(`Fix ${chip} today`, 0);
    expect(result.prompt).toBe("Fix #42 Flaky login today");
    expect(result.note).toContain("plain labels");
  });

  it("says when attachments or other context were left out", () => {
    expect(scheduledTaskPromptFromComposer("Fix it", 2).note).toContain("left out");
  });
});
