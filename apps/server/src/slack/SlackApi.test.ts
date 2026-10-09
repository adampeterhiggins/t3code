import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import * as SlackApi from "./SlackApi.ts";
import { SlackAuth } from "./SlackAuth.ts";

const account = {
  userId: "U1",
  userName: "Ada",
  teamId: "T1",
  teamName: "Acme",
  teamUrl: "https://acme.slack.com/",
};
const USERS: Record<string, string> = { U1: "Ada", U2: "Grace", U3: "Linus" };

const PARENT_TS = "1727779620.000100";
const REPLY_TS = "1727779680.000200";
const LAST_TS = "1727779740.000300";
const THREAD = [
  { ts: PARENT_TS, thread_ts: PARENT_TS, user: "U1", text: "Deploy is failing", reply_count: 2 },
  {
    ts: REPLY_TS,
    thread_ts: PARENT_TS,
    user: "U2",
    text: "<@U3> can you look?",
    files: [{ name: "trace.har" }],
  },
  { ts: LAST_TS, thread_ts: PARENT_TS, bot_profile: { name: "CI Bot" }, text: "Build green" },
];

function makeHarness(replies: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; params: URLSearchParams }> = [];

  let revoked = 0;
  const reply = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const method = request.url.split("/").at(-1) ?? "";
      const params =
        request.body._tag === "Uint8Array"
          ? new URLSearchParams(new TextDecoder().decode(request.body.body))
          : new URLSearchParams();
      calls.push({ method, params });
      if (method in replies) return reply(request, replies[method]);
      switch (method) {
        case "users.info": {
          const id = params.get("user") ?? "";
          const name = USERS[id];
          return reply(
            request,
            name === undefined
              ? { ok: false, error: "user_not_found" }
              : { ok: true, user: { name: name.toLowerCase(), profile: { display_name: name } } },
          );
        }
        case "conversations.replies":
          return reply(request, { ok: true, messages: THREAD });
        case "conversations.info":
          return reply(request, { ok: true, channel: { id: "C1", name: "eng" } });
        default:
          return reply(request, { ok: false, error: "unknown_method" });
      }
    }),
  );
  const layer = Layer.effect(SlackApi.SlackApi, SlackApi.make).pipe(
    Layer.provide(KeyValueStore.layerMemory),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(SlackAuth)({
        accessToken: Effect.succeed("xoxp-token"),
        account: Effect.succeed(account),
        markRevoked: Effect.sync(() => void revoked++),
      }),
    ),
  );
  return { layer, calls, revokedCount: () => revoked };
}

const threadInput = {
  channelId: "C1",
  ts: REPLY_TS,
  threadTs: PARENT_TS,
  url: "https://acme.slack.com/archives/C1/p1727779680000200?thread_ts=1727779620.000100",
};

it.effect("labels channels and direct messages and reads the thread from the permalink", () => {
  const harness = makeHarness({
    "search.messages": {
      ok: true,
      messages: {
        matches: [
          {
            ts: REPLY_TS,
            text: "ping <@U3>\n  about   &lt;deploy&gt;",
            user: "U2",
            permalink: `https://acme.slack.com/archives/C1/p1727779680000200?thread_ts=${PARENT_TS}&cid=C1`,
            channel: { id: "C1", name: "eng", is_private: false },
          },
          {
            ts: LAST_TS,
            text: "hello",
            user: "U1",
            username: "ada",
            permalink: "https://acme.slack.com/archives/D9/p1727779740000300",
            channel: { id: "D9", name: "U2", is_im: true },
          },
          {
            ts: PARENT_TS,
            text: "hey all",
            user: "U9",
            username: "someone",
            permalink: "https://acme.slack.com/archives/G1/p1727779620000100",
            channel: { id: "G1", name: "mpdm-a--b-1", is_mpim: true },
          },
        ],
      },
    },
  });
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    assert.deepEqual(yield* api.searchMessages({ query: "  " }), { messages: [] });
    assert.strictEqual(harness.calls.length, 0);
    const { messages } = yield* api.searchMessages({ query: "deploy" });
    const search = harness.calls.find((call) => call.method === "search.messages");
    assert.strictEqual(search?.params.get("sort"), "timestamp");
    assert.deepEqual(
      messages.map((message) => [message.channelLabel, message.threadTs, message.authorName]),
      [
        ["#eng", PARENT_TS, "Grace"],
        ["@Grace", null, "Ada"],
        ["Group message", null, "someone"],
      ],
    );
    assert.strictEqual(messages[0]?.text, "ping @U3 about <deploy>");
    assert.strictEqual(messages[0]?.postedAt, "2024-10-01T10:48:00.000Z");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("snapshots a whole thread with the linked message marked and mentions resolved", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    const context = yield* api.getThread({ ...threadInput, scope: "thread" });
    const replies = harness.calls.find((call) => call.method === "conversations.replies");
    assert.strictEqual(replies?.params.get("ts"), PARENT_TS);
    assert.deepEqual(
      {
        teamId: context.teamId,
        channelLabel: context.channelLabel,
        threadTs: context.threadTs,
        authorName: context.authorName,
        title: context.title,
        replyCount: context.replyCount,
      },
      {
        teamId: "T1",
        channelLabel: "#eng",
        threadTs: PARENT_TS,
        authorName: "Grace",
        title: "@Linus can you look?",
        replyCount: 2,
      },
    );
    assert.include(context.markdown, "# Slack thread in #eng");
    assert.include(context.markdown, "2 replies");
    assert.include(
      context.markdown,
      "**Grace** · 2024-10-01 10:48 UTC · linked message\n@Linus can you look?\nFiles: trace.har (not downloaded)",
    );
    assert.include(context.markdown, "**CI Bot** · 2024-10-01 10:49 UTC\nBuild green");
    // Each user is looked up once.
    assert.strictEqual(harness.calls.filter((call) => call.method === "users.info").length, 3);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("keeps only the linked message when asked for the message alone", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    const context = yield* api.getThread({ ...threadInput, scope: "message" });
    assert.strictEqual(context.replyCount, 0);
    assert.include(context.markdown, "# Slack message in #eng");
    assert.notInclude(context.markdown, "Deploy is failing");
    assert.notInclude(context.markdown, "linked message");
    assert.include(context.markdown, "@Linus can you look?");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("reads the whole thread from its root when a reply's link omits thread_ts", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    const { threadTs: _omitted, ...input } = threadInput;
    // Slack answers a read from a reply with only that reply, so a second read must use the root.
    const context = yield* api.getThread({ ...input, scope: "thread" });
    const reads = harness.calls.filter((call) => call.method === "conversations.replies");
    assert.deepStrictEqual(
      reads.map((call) => call.params.get("ts")),
      [REPLY_TS, PARENT_TS],
    );
    assert.strictEqual(context.threadTs, PARENT_TS);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("reports a conversation the account cannot see as not found", () => {
  const harness = makeHarness({
    "conversations.replies": { ok: false, error: "channel_not_found" },
  });
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    const error = yield* Effect.flip(api.getThread({ ...threadInput, scope: "thread" }));
    assert.strictEqual(error.reason, "not-found");
    assert.strictEqual(harness.revokedCount(), 0);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("marks the connection revoked when Slack rejects the token", () => {
  const harness = makeHarness({ "search.messages": { ok: false, error: "invalid_auth" } });
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    const error = yield* Effect.flip(api.searchMessages({ query: "deploy" }));
    assert.strictEqual(error.reason, "revoked");
    assert.strictEqual(harness.revokedCount(), 1);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("reads a link preview once and keeps it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    const preview = yield* api.getLinkPreview(threadInput);
    assert.deepEqual(preview, {
      channelLabel: "#eng",
      authorName: "Grace",
      title: "@Linus can you look?",
    });
    const reads = harness.calls.length;
    assert.deepEqual(yield* api.getLinkPreview(threadInput), preview);
    assert.strictEqual(harness.calls.length, reads);
  }).pipe(Effect.provide(harness.layer));
});

it.effect(
  "searches explicit mentions since the preceding day and preserves channel and reply identity",
  () => {
    const harness = makeHarness({
      "search.messages": {
        ok: true,
        messages: {
          matches: [
            {
              ts: REPLY_TS,
              user: "U2",
              text: "<@U1> fix this",
              permalink: threadInput.url,
              channel: { id: "C1", name: "eng" },
            },
            {
              ts: LAST_TS,
              user: "U3",
              text: "<@U1> hello",
              permalink: "https://acme.slack.com/archives/D1/p1727779740000300",
              channel: { id: "D1", name: "ada", is_im: true },
            },
          ],
        },
      },
    });
    return Effect.gen(function* () {
      const api = yield* SlackApi.SlackApi;
      const matches = yield* api.searchMentions({ userId: "U1", afterDay: "2024-10-01" });
      assert.strictEqual(harness.calls[0]?.params.get("query"), "<@U1> after:2024-09-30");
      assert.strictEqual(harness.calls[0]?.params.get("sort_dir"), "desc");
      assert.strictEqual(matches[0]?.threadTs, PARENT_TS);
      assert.strictEqual(matches[0]?.channelName, "eng");
      assert.strictEqual(matches[1]?.channelName, null);
    }).pipe(Effect.provide(harness.layer));
  },
);
