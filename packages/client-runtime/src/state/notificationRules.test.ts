import {
  EnvironmentId,
  ProjectId,
  type ThreadPullRequestLink,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  hasNewPullRequestNews,
  pickThreadNotification,
  pullRequestWatchNews,
  type NotificationRules,
} from "./notificationRules.ts";

const project = { environmentId: EnvironmentId.make("env-1"), projectId: ProjectId.make("p-1") };
const ALL_ON: NotificationRules = { mutedNotificationEvents: [], mutedNotificationProjects: [] };

describe("pickThreadNotification", () => {
  it("raises the most urgent event when nothing is muted", () => {
    expect(pickThreadNotification(["approval", "completed"], ALL_ON, project)).toBe("approval");
  });

  it("skips muted events and falls through to the next one", () => {
    const rules: NotificationRules = { ...ALL_ON, mutedNotificationEvents: ["approval"] };
    expect(pickThreadNotification(["approval", "pull-request"], rules, project)).toBe(
      "pull-request",
    );
    expect(pickThreadNotification(["approval"], rules, project)).toBeNull();
  });

  it("keeps a muted project quiet for every event, in that environment only", () => {
    const rules: NotificationRules = { ...ALL_ON, mutedNotificationProjects: ["env-1:p-1"] };
    expect(pickThreadNotification(["approval", "failed"], rules, project)).toBeNull();
    expect(
      pickThreadNotification(["approval"], rules, {
        ...project,
        environmentId: EnvironmentId.make("env-2"),
      }),
    ).toBe("approval");
  });

  it("tells usage limits apart from failures", () => {
    const rules: NotificationRules = { ...ALL_ON, mutedNotificationEvents: ["failed"] };
    expect(pickThreadNotification(["limited"], rules, project)).toBe("limited");
    expect(pickThreadNotification(["failed"], rules, project)).toBeNull();
  });
});

function link(watch: Partial<ThreadPullRequestWatch> | undefined): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "acme/app",
    number: 7,
    url: "https://github.com/acme/app/pull/7",
    source: "manual",
    linkedAt: "2026-10-01T00:00:00.000Z",
    snapshot: null,
    stack: null,
    ...(watch === undefined
      ? {}
      : {
          watch: {
            startedAt: "2026-10-01T00:00:00.000Z",
            headSha: "abc",
            failedChecks: [],
            passed: false,
            passedChecks: [],
            remarksThrough: "2026-10-01T00:00:00.000Z",
            remarkIds: [],
            conflicting: false,
            wakes: 0,
            ...watch,
          },
        }),
  };
}

describe("pull request watch news", () => {
  const news = (watch?: Partial<ThreadPullRequestWatch>) => pullRequestWatchNews([link(watch)]);

  it("has nothing to say without a watch or findings", () => {
    expect(news()).toEqual([]);
    expect(news({ passed: true })).toEqual([]);
  });

  it("reports a newly failed check, conflict, or change request", () => {
    expect(hasNewPullRequestNews(news({}), news({ failedChecks: ["lint"] }))).toBe(true);
    expect(hasNewPullRequestNews(news({}), news({ conflicting: true }))).toBe(true);
    expect(hasNewPullRequestNews(news({}), news({ changesRequested: true }))).toBe(true);
  });

  it("stays quiet when findings repeat or clear", () => {
    const failing = news({ failedChecks: ["lint"] });
    expect(hasNewPullRequestNews(failing, news({ failedChecks: ["lint"] }))).toBe(false);
    expect(hasNewPullRequestNews(failing, news({}))).toBe(false);
  });

  it("treats the same check failing on a new commit as news", () => {
    expect(
      hasNewPullRequestNews(
        news({ failedChecks: ["lint"] }),
        news({ headSha: "def", failedChecks: ["lint"] }),
      ),
    ).toBe(true);
  });

  it("treats a conflict that clears and returns as news", () => {
    expect(hasNewPullRequestNews(news({}), news({ conflicting: true }))).toBe(true);
  });
});
