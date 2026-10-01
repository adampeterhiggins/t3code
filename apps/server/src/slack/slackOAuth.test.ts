import { assert, describe, it } from "@effect/vitest";

import { SLACK_REDIRECT_URI } from "@t3tools/contracts";

import {
  buildSlackAuthorizeUrl,
  readPastedSlackCallback,
  SLACK_LOOPBACK_PORT,
} from "./slackOAuth.ts";

describe("buildSlackAuthorizeUrl", () => {
  it("listens on the port the registered redirect URI names", () => {
    assert.strictEqual(new URL(SLACK_REDIRECT_URI).port, String(SLACK_LOOPBACK_PORT));
  });

  it("asks for user scopes only, with PKCE and the localhost redirect", () => {
    const url = new URL(buildSlackAuthorizeUrl({ clientId: "c1", state: "s1", challenge: "ch" }));
    assert.strictEqual(url.searchParams.get("scope"), "");
    assert.include(url.searchParams.get("user_scope") ?? "", "search:read");
    assert.strictEqual(url.searchParams.get("code_challenge"), "ch");
    assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(url.searchParams.get("redirect_uri"), "http://localhost:47832/callback");
  });
});

describe("readPastedSlackCallback", () => {
  it("accepts the registered loopback redirect with a matching state", () => {
    assert.deepEqual(
      readPastedSlackCallback("http://localhost:47832/callback?code=abc&state=s1", "s1"),
      { _tag: "Code", code: "abc" },
    );
  });

  it("reports a denied consent screen", () => {
    assert.deepEqual(
      readPastedSlackCallback("http://localhost:47832/callback?error=access_denied&state=s1", "s1"),
      { _tag: "Denied" },
    );
  });

  it("rejects a redirect from another flow, host, or with repeated parameters", () => {
    for (const pasted of [
      "http://localhost:47832/callback?code=abc&state=other",
      "http://localhost:47832/callback?code=abc&state=s1&state=s1",
      "http://127.0.0.1:47832/callback?code=abc&state=s1",
      "http://localhost:47831/callback?code=abc&state=s1",
      "http://localhost:47832/callback?state=s1",
      "not a url",
    ]) {
      assert.strictEqual(readPastedSlackCallback(pasted, "s1")._tag, "Invalid", pasted);
    }
  });
});
