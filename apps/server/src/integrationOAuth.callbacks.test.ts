import { describe, expect, it } from "vite-plus/test";
import { readPastedLinearCallback } from "./linear/linearOAuth.ts";
import { readPastedNotionCallback } from "./notion/notionOAuth.ts";
import { readPastedSlackCallback } from "./slack/slackOAuth.ts";

describe.each([
  ["linear", readPastedLinearCallback],
  ["notion", readPastedNotionCallback],
  ["slack", readPastedSlackCallback],
] as const)("%s remote paste-back", (integration, read) => {
  const uri = `https://t3.example.test/oauth/${integration}/callback`;
  it("accepts the configured callback and rejects loopback or another origin", () => {
    expect(read(`${uri}?code=code&state=nonce`, "nonce", uri)).toEqual({
      _tag: "Code",
      code: "code",
    });
    for (const url of [
      `http://localhost:47833/callback?code=code&state=nonce`,
      `https://other.example.test/oauth/${integration}/callback?code=code&state=nonce`,
      `${uri}?code=code&state=wrong`,
      `${uri}?code=code&code=other&state=nonce`,
    ])
      expect(read(url, "nonce", uri)._tag).toBe("Invalid");
  });
});
