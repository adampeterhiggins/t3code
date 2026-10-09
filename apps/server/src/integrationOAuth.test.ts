import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { resolveIntegrationRedirect } from "./integrationOAuth.ts";

const resolve = (uri?: string) =>
  resolveIntegrationRedirect({
    configured: Option.fromNullishOr(uri),
    variable: "T3CODE_LINEAR_REDIRECT_URI",
    loopbackUri: "http://127.0.0.1:47831/callback",
    callbackPath: "/oauth/linear/callback",
  });

describe("integration redirect configuration", () => {
  it("preserves the local flow when no callback is configured", () => {
    expect(resolve()).toEqual({ _tag: "Loopback", uri: "http://127.0.0.1:47831/callback" });
    expect(resolve(" ")).toEqual(resolve());
  });
  it("uses an explicitly registered HTTPS callback without guessing the client's origin", () => {
    expect(resolve("https://t3.example.test/oauth/linear/callback")).toEqual({
      _tag: "Server",
      uri: "https://t3.example.test/oauth/linear/callback",
    });
  });
  it("rejects destinations the server cannot safely serve", () => {
    for (const uri of [
      "not a URL",
      "http://t3.example.test/oauth/linear/callback",
      "https://t3.example.test/callback",
      "https://t3.example.test/oauth/linear/callback?token=secret",
      "https://t3.example.test/oauth/linear/callback#fragment",
      "https://user:secret@t3.example.test/oauth/linear/callback",
    ]) {
      expect(resolve(uri)._tag).toBe("Invalid");
    }
  });
});
