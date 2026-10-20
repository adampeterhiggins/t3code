import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  discordContentToMarkdown,
  millisToSnowflake,
  snowflakeToMillis,
} from "./discordMarkdown.ts";

it("reads the time out of a Discord id, and makes the smallest id for a time", () => {
  // Discord's documented example: 175928847299117063 was created at 2016-04-30T11:18:25.796Z.
  assert.strictEqual(
    DateTime.formatIso(DateTime.makeUnsafe(snowflakeToMillis("175928847299117063"))),
    "2016-04-30T11:18:25.796Z",
  );
  const ms = Date.parse("2026-10-01T00:00:00Z");
  assert.strictEqual(snowflakeToMillis(millisToSnowflake(ms)), ms);
});

it("turns mentions, emoji, and timestamps into what a reader sees", () => {
  const names = {
    users: new Map([["1", "Ada"]]),
    channels: new Map([["2", "eng"]]),
  };
  assert.strictEqual(
    discordContentToMarkdown(
      "<@1> and <@!1> in <#2>, <@&3> <:shipit:4> <a:party:5> at <t:1727779620:R> <@6>",
      names,
    ),
    "@Ada and @Ada in #eng, @role :shipit: :party: at 2024-10-01 10:47 UTC @6",
  );
});
