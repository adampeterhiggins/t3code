import { describe, expect, it } from "vite-plus/test";

import {
  linkWatchNotificationLabel,
  pullRequestNotificationLabel,
} from "./TimelineWorkEntryRow.logic";
import type { TimelineWorkEntry } from "./timelineRowContext";

const notification = (source: object) =>
  ({ projectedItem: { item: { type: "notification", source } } }) as never as TimelineWorkEntry;

const url = "https://github.com/o/r/pull/650";

describe("pullRequestNotificationLabel", () => {
  it("links the reference to the watched pull request", () => {
    expect(
      pullRequestNotificationLabel(
        notification({ kind: "monitor", pullRequestUrl: url }),
        "#650: checks passed",
        [],
      ),
    ).toEqual({ url, reference: "#650", rest: ": checks passed" });
  });

  it("finds the pull request among the thread's links when the notification has no URL", () => {
    const label = pullRequestNotificationLabel(
      notification({ kind: "monitor" }),
      "#650: checks passed",
      [
        { number: 12, url: "https://github.com/o/r/pull/12" },
        { number: 650, url },
      ],
    );
    expect(label?.url).toBe(url);
    expect(
      pullRequestNotificationLabel(notification({ kind: "monitor" }), "#7: done", [
        { number: 650, url },
      ]),
    ).toBeNull();
  });

  it("leaves other notifications alone", () => {
    expect(
      pullRequestNotificationLabel(notification({ kind: "command" }), "#650: done", [
        { number: 650, url },
      ]),
    ).toBeNull();
    expect(
      pullRequestNotificationLabel(
        notification({ kind: "monitor", pullRequestUrl: url }),
        "Build finished",
        [],
      ),
    ).toBeNull();
  });
});

describe("linkWatchNotificationLabel", () => {
  const slackUrl = "https://acme.slack.com/archives/C1/p1700000000000100";

  it("separates the watched item's name from its changes", () => {
    expect(
      linkWatchNotificationLabel(
        notification({ kind: "monitor", linkUrl: slackUrl }),
        "Slack thread Release: go/no-go: 2 new messages",
      ),
    ).toEqual({
      url: slackUrl,
      subject: "Slack thread Release: go/no-go",
      rest: ": 2 new messages",
    });
  });

  it("previews the whole label when clipping dropped the changes", () => {
    expect(
      linkWatchNotificationLabel(
        notification({ kind: "monitor", linkUrl: slackUrl }),
        "Slack thread Plan…",
      ),
    ).toEqual({ url: slackUrl, subject: "Slack thread Plan…", rest: "" });
  });

  it("leaves pull request watches and other notifications alone", () => {
    expect(
      linkWatchNotificationLabel(
        notification({ kind: "monitor", pullRequestUrl: url }),
        "#650: done",
      ),
    ).toBeNull();
    expect(linkWatchNotificationLabel(notification({ kind: "command" }), "Build: done")).toBeNull();
  });
});
