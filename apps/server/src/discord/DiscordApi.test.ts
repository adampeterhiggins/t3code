import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import * as DiscordApi from "./DiscordApi.ts";
import { DiscordAuth } from "./DiscordAuth.ts";

const GUILD = "1100000000000000001";
const OTHER_GUILD = "1100000000000000002";
const CHANNEL = "1200000000000000001";
/** A thread started from message `THREAD` in `CHANNEL`, so they share an id. */
const THREAD = "1300000000000000100";
const REPLY = "1300000000000000200";
const LAST = "1300000000000000300";

const user = (id: string, name: string) => ({
  id,
  username: name.toLowerCase(),
  global_name: name,
});
const ADA = user("1", "Ada");
const GRACE = user("2", "Grace");

const message = (
  id: string,
  channelId: string,
  author: typeof ADA,
  content: string,
  extra = {},
) => ({
  id,
  channel_id: channelId,
  type: 0,
  content,
  timestamp: "2026-10-01T10:47:00.000000+00:00",
  author,
  mentions: [],
  attachments: [],
  ...extra,
});

const CHANNELS: Record<string, unknown> = {
  [CHANNEL]: { id: CHANNEL, type: 0, name: "eng", guild_id: GUILD },
  [THREAD]: { id: THREAD, type: 11, name: "Deploy", guild_id: GUILD, parent_id: CHANNEL },
};

function makeHarness(routes: Record<string, { status?: number; body: unknown }> = {}) {
  const paths: Array<string> = [];
  const methods: Array<string> = [];
  let revoked = 0;
  const reply = (request: HttpClientRequest.HttpClientRequest, status: number, body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname.replace("/api/v10", "");
      paths.push(path);
      methods.push(`${request.method} ${path}`);
      const route = routes[path];
      if (route !== undefined) return reply(request, route.status ?? 200, route.body);
      const channel = /^\/channels\/(\d+)$/.exec(path)?.[1];
      if (channel !== undefined && CHANNELS[channel] !== undefined) {
        return reply(request, 200, CHANNELS[channel]);
      }
      return reply(request, 404, { code: 10003, message: "Unknown Channel" });
    }),
  );
  const layer = Layer.effect(DiscordApi.DiscordApi, DiscordApi.make).pipe(
    Layer.provide(KeyValueStore.layerMemory),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(DiscordAuth)({
        botToken: Effect.succeed("bot-token"),
        account: Effect.succeed({ botUserId: "9", botName: "T3 Code", applicationId: "9" }),
        markRevoked: Effect.sync(() => void revoked++),
      }),
    ),
  );
  return { layer, paths, methods, revokedCount: () => revoked };
}

const replyUrl = `https://discord.com/channels/${GUILD}/${THREAD}/${REPLY}`;

it.effect("reads a reply's whole thread, starting from the message the thread came from", () => {
  const harness = makeHarness({
    [`/channels/${THREAD}/messages/${REPLY}`]: {
      body: message(REPLY, THREAD, GRACE, "<@1> can you look at <#1200000000000000001>?", {
        mentions: [ADA],
      }),
    },
    // Newest first, as Discord returns them, with the starter placeholder at the start.
    [`/channels/${THREAD}/messages`]: {
      body: [
        message(LAST, THREAD, ADA, "Fixed it", { attachments: [{ filename: "trace.har" }] }),
        message(REPLY, THREAD, GRACE, "<@1> can you look at <#1200000000000000001>?", {
          mentions: [ADA],
        }),
        message(THREAD, THREAD, ADA, "", { type: 21 }),
      ],
    },
    [`/channels/${CHANNEL}/messages/${THREAD}`]: {
      body: message(THREAD, CHANNEL, ADA, "Deploy is failing"),
    },
  });
  return Effect.gen(function* () {
    const api = yield* DiscordApi.DiscordApi;
    const thread = yield* api.getThread({
      guildId: GUILD,
      channelId: THREAD,
      messageId: REPLY,
      url: replyUrl,
      scope: "thread",
    });
    assert.strictEqual(thread.channelLabel, "#eng › Deploy");
    assert.strictEqual(thread.threadId, THREAD);
    assert.strictEqual(thread.authorName, "Grace");
    assert.strictEqual(thread.title, "@Ada can you look at #eng?");
    assert.strictEqual(thread.replyCount, 2);
    const markdown = thread.markdown;
    assert.include(markdown, "# Discord thread in #eng › Deploy");
    assert.isBelow(markdown.indexOf("Deploy is failing"), markdown.indexOf("can you look"));
    assert.include(markdown, "**Grace** · 2026-10-01 10:47 UTC · linked message");
    assert.include(markdown, "Files: trace.har (not downloaded)");
    assert.notInclude(markdown, "<@1>");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("takes a message alone when asked", () => {
  const harness = makeHarness({
    [`/channels/${THREAD}/messages/${REPLY}`]: {
      body: message(REPLY, THREAD, GRACE, "Just this"),
    },
  });
  return Effect.gen(function* () {
    const api = yield* DiscordApi.DiscordApi;
    const thread = yield* api.getThread({
      guildId: GUILD,
      channelId: THREAD,
      messageId: REPLY,
      url: replyUrl,
      scope: "message",
    });
    assert.strictEqual(thread.replyCount, 0);
    assert.include(thread.markdown, "# Discord message in #eng › Deploy");
    assert.isFalse(harness.paths.includes(`/channels/${THREAD}/messages`));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("searches every server, newest first, skipping one that is still indexing", () => {
  const harness = makeHarness({
    "/users/@me/guilds": {
      body: [
        { id: GUILD, name: "Acme" },
        { id: OTHER_GUILD, name: "Other" },
      ],
    },
    [`/guilds/${GUILD}/messages/search`]: {
      body: {
        total_results: 2,
        messages: [
          [message(LAST, THREAD, ADA, "deploy   fixed\nnow")],
          [message(THREAD, CHANNEL, GRACE, "deploy broke")],
        ],
        threads: [CHANNELS[THREAD]],
      },
    },
    [`/guilds/${OTHER_GUILD}/messages/search`]: {
      status: 202,
      body: { message: "Index not yet available. Try again later", code: 110000 },
    },
  });
  return Effect.gen(function* () {
    const api = yield* DiscordApi.DiscordApi;
    const result = yield* api.searchMessages({ query: "deploy" });
    assert.deepStrictEqual(
      result.messages.map((found) => [found.channelLabel, found.authorName, found.text]),
      [
        ["#eng › Deploy", "Ada", "deploy fixed now"],
        ["#eng", "Grace", "deploy broke"],
      ],
    );
    assert.strictEqual(
      result.messages[0]?.url,
      `https://discord.com/channels/${GUILD}/${THREAD}/${LAST}`,
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("lists the bot's servers by name, and leaves one", () => {
  const harness = makeHarness({
    "/users/@me/guilds": {
      body: [
        { id: OTHER_GUILD, name: "Zeta", icon: null },
        { id: GUILD, name: "Acme", icon: "abc" },
      ],
    },
    [`/users/@me/guilds/${GUILD}`]: { status: 204, body: null },
  });
  return Effect.gen(function* () {
    const api = yield* DiscordApi.DiscordApi;
    const { servers } = yield* api.listServers;
    assert.deepStrictEqual(servers, [
      {
        id: GUILD,
        name: "Acme",
        iconUrl: `https://cdn.discordapp.com/icons/${GUILD}/abc.png?size=64`,
      },
      { id: OTHER_GUILD, name: "Zeta", iconUrl: null },
    ]);
    yield* api.leaveServer({ guildId: GUILD });
    assert.include(harness.methods, `DELETE /users/@me/guilds/${GUILD}`);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("drops the token when Discord rejects it", () => {
  const harness = makeHarness({
    [`/channels/${THREAD}/messages/${REPLY}`]: { status: 401, body: { code: 0 } },
  });
  return Effect.gen(function* () {
    const api = yield* DiscordApi.DiscordApi;
    const error = yield* Effect.flip(
      api.getThread({
        guildId: GUILD,
        channelId: THREAD,
        messageId: REPLY,
        url: replyUrl,
        scope: "message",
      }),
    );
    assert.strictEqual(error.reason, "revoked");
    assert.strictEqual(harness.revokedCount(), 1);
  }).pipe(Effect.provide(harness.layer));
});
