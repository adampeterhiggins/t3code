import { assert, describe, it } from "@effect/vitest";

import {
  mentionedUserIds,
  renderSlackThreadMarkdown,
  slackTextToMarkdown,
  slackTsToDisplay,
  slackTsToIso,
  type SlackRenderedMessage,
} from "./slackMarkdown.ts";

describe("slackTsToIso", () => {
  it("reads the seconds part of a message timestamp", () => {
    assert.strictEqual(slackTsToIso("1727779620.000100"), "2024-10-01T10:47:00.000Z");
    assert.strictEqual(slackTsToDisplay("1727779620.000100"), "2024-10-01 10:47 UTC");
  });
});

describe("slackTextToMarkdown", () => {
  const names = new Map([["U1", "Ada"]]);

  it("resolves mentions, channels, broadcasts, and links", () => {
    assert.strictEqual(
      slackTextToMarkdown(
        "<@U1> <@U2|grace> <@U3> in <#C1|eng> <#C2> <!here> <!subteam^S1|@infra> see <https://x.test/a?b=1&amp;c=2|the doc> or <https://y.test>",
        names,
      ),
      "@Ada @grace @U3 in #eng #C2 @here @infra see [the doc](https://x.test/a?b=1&c=2) or https://y.test",
    );
  });

  it("decodes Slack's entities", () => {
    assert.strictEqual(
      slackTextToMarkdown("a &lt;b&gt; &amp;&amp; `x &gt; 1`", names),
      "a <b> && `x > 1`",
    );
  });

  it("collects mentioned user ids", () => {
    assert.deepEqual(mentionedUserIds("<@U1> and <@W2|bob>, not <#C1>"), ["U1", "W2"]);
  });
});

const message = (index: number, text: string, files: Array<string> = []): SlackRenderedMessage => ({
  ts: `${1727779620 + index * 60}.000100`,
  authorName: `Author ${index}`,
  text,
  files,
});

describe("renderSlackThreadMarkdown", () => {
  const base = { channelLabel: "#eng", url: "https://acme.slack.com/archives/C1/p1" };

  it("renders a thread with the linked message marked and files listed", () => {
    const markdown = renderSlackThreadMarkdown(
      {
        ...base,
        scope: "thread",
        messages: [message(0, "Parent"), message(1, "Reply", ["a.png", "b.har"])],
        linkedTs: message(1, "").ts,
      },
      10_000,
    );
    assert.strictEqual(
      markdown,
      [
        "# Slack thread in #eng\nurl: https://acme.slack.com/archives/C1/p1\n1 reply",
        "**Author 0** · 2024-10-01 10:47 UTC\nParent",
        "**Author 1** · 2024-10-01 10:48 UTC · linked message\nReply\nFiles: a.png, b.har (not downloaded)",
      ].join("\n\n"),
    );
  });

  it("does not mark a lone message", () => {
    const markdown = renderSlackThreadMarkdown(
      { ...base, scope: "message", messages: [message(0, "Only")], linkedTs: message(0, "").ts },
      10_000,
    );
    assert.strictEqual(
      markdown,
      "# Slack message in #eng\nurl: https://acme.slack.com/archives/C1/p1\n\n**Author 0** · 2024-10-01 10:47 UTC\nOnly",
    );
  });

  it("keeps the parent, the linked message, and the newest replies, marking gaps", () => {
    const messages = Array.from({ length: 10 }, (_, index) => message(index, "x".repeat(100)));
    const markdown = renderSlackThreadMarkdown(
      { ...base, scope: "thread", messages, linkedTs: messages[3]!.ts },
      700,
    );
    assert.isAtMost(markdown.length, 700);
    const authors = [...markdown.matchAll(/\*\*(Author \d)\*\*/g)].map((match) => match[1]);
    assert.deepEqual(authors, ["Author 0", "Author 3", "Author 8", "Author 9"]);
    assert.include(markdown, "_2 messages omitted._");
    assert.include(markdown, "_4 messages omitted._");
    assert.include(markdown, "linked message");
  });

  it("cuts the parent and linked message when they alone exceed the budget", () => {
    const messages = [
      message(0, "p".repeat(5_000)),
      message(1, "r".repeat(100)),
      message(2, "l".repeat(5_000)),
    ];
    const markdown = renderSlackThreadMarkdown(
      { ...base, scope: "thread", messages, linkedTs: messages[2]!.ts },
      1_000,
    );
    assert.isAtMost(markdown.length, 1_000);
    assert.include(markdown, "**Author 0**");
    assert.include(markdown, "**Author 2**");
    assert.include(markdown, "_1 message omitted._");
  });
});
