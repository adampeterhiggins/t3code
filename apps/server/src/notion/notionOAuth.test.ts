import { describe, expect, it } from "vite-plus/test";
import {
  buildNotionAuthorizeUrl,
  NOTION_REDIRECT_URI,
  readPastedNotionCallback,
} from "./notionOAuth.ts";
describe("Notion OAuth", () => {
  it("requests a user page selection and binds the redirect to state", () => {
    const url = new URL(buildNotionAuthorizeUrl({ clientId: "client", state: "nonce" }));
    expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client",
      redirect_uri: NOTION_REDIRECT_URI,
      response_type: "code",
      owner: "user",
      state: "nonce",
    });
    expect(readPastedNotionCallback(`${NOTION_REDIRECT_URI}?code=ok&state=nonce`, "nonce")).toEqual(
      { _tag: "Code", code: "ok" },
    );
  });
  it("rejects mismatched state, duplicate parameters, and other redirect destinations", () => {
    for (const url of [
      `${NOTION_REDIRECT_URI}?code=ok&state=wrong`,
      `${NOTION_REDIRECT_URI}?code=ok&state=nonce&state=nonce`,
      `${NOTION_REDIRECT_URI}?code=ok&code=other&state=nonce`,
      "https://evil.test/callback?code=ok&state=nonce",
    ])
      expect(readPastedNotionCallback(url, "nonce")._tag).toBe("Invalid");
    expect(
      readPastedNotionCallback(`${NOTION_REDIRECT_URI}?error=access_denied&state=nonce`, "nonce"),
    ).toEqual({ _tag: "Denied" });
  });
});
