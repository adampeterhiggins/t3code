import { describe, expect, it } from "vite-plus/test";
import {
  buildGoogleAuthorizeUrl,
  GOOGLE_REDIRECT_URI,
  readPastedGoogleCallback,
} from "./googleOAuth.ts";
describe("Google OAuth", () => {
  it("requests read-only offline access and binds the redirect to state", () => {
    const url = new URL(buildGoogleAuthorizeUrl({ clientId: "client", state: "nonce" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client",
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/directory.readonly https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent",
      state: "nonce",
    });
    expect(readPastedGoogleCallback(`${GOOGLE_REDIRECT_URI}?code=ok&state=nonce`, "nonce")).toEqual(
      { _tag: "Code", code: "ok" },
    );
  });
  it("rejects mismatched state, duplicate parameters, and other redirect destinations", () => {
    for (const url of [
      `${GOOGLE_REDIRECT_URI}?code=ok&state=wrong`,
      `${GOOGLE_REDIRECT_URI}?code=ok&state=nonce&state=nonce`,
      `${GOOGLE_REDIRECT_URI}?code=ok&code=other&state=nonce`,
      "https://evil.test/callback?code=ok&state=nonce",
    ])
      expect(readPastedGoogleCallback(url, "nonce")._tag).toBe("Invalid");
    expect(
      readPastedGoogleCallback(`${GOOGLE_REDIRECT_URI}?error=access_denied&state=nonce`, "nonce"),
    ).toEqual({ _tag: "Denied" });
  });
});
