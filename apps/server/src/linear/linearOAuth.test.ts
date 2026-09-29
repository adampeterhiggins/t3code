import { assert, describe, it } from "@effect/vitest";

import { readPastedLinearCallback } from "./linearOAuth.ts";

describe("readPastedLinearCallback", () => {
  it("accepts the registered loopback redirect with a matching state", () => {
    assert.deepEqual(
      readPastedLinearCallback("http://127.0.0.1:47831/callback?code=abc&state=s1", "s1"),
      { _tag: "Code", code: "abc" },
    );
  });

  it("reports a denied consent screen", () => {
    assert.deepEqual(
      readPastedLinearCallback(
        "http://127.0.0.1:47831/callback?error=access_denied&state=s1",
        "s1",
      ),
      { _tag: "Denied" },
    );
  });

  it("rejects a redirect from another flow, host, or with repeated parameters", () => {
    for (const pasted of [
      "http://127.0.0.1:47831/callback?code=abc&state=other",
      "http://127.0.0.1:47831/callback?code=abc&state=s1&state=s1",
      "http://localhost:47831/callback?code=abc&state=s1",
      "http://127.0.0.1:47832/callback?code=abc&state=s1",
      "http://127.0.0.1:47831/callback?state=s1",
      "not a url",
    ]) {
      assert.strictEqual(readPastedLinearCallback(pasted, "s1")._tag, "Invalid", pasted);
    }
  });
});
