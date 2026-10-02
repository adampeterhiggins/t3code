export const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
export const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
export const NOTION_REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";

/**
 * Notion matches redirect URIs exactly, port included, so the loopback
 * listener has one fixed port that must stay registered on the OAuth app.
 */
export const NOTION_LOOPBACK_PORT = 47833;
export { NOTION_REDIRECT_URI } from "@t3tools/contracts";
import { NOTION_REDIRECT_URI } from "@t3tools/contracts";

export function buildNotionAuthorizeUrl(input: {
  readonly clientId: string;
  readonly state: string;
}): string {
  const url = new URL(NOTION_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: NOTION_REDIRECT_URI,
    response_type: "code",
    owner: "user",
    state: input.state,
  }).toString();
  return url.toString();
}

export type NotionCallbackResult =
  | { readonly _tag: "Code"; readonly code: string }
  | { readonly _tag: "Denied" }
  | { readonly _tag: "Invalid"; readonly reason: string };

function singleParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

/** Reads the loopback callback query. `state` must match the flow exactly once. */
export function readNotionCallback(url: URL, expectedState: string): NotionCallbackResult {
  if (singleParam(url, "state") !== expectedState) {
    return { _tag: "Invalid", reason: "The sign-in link does not belong to this Notion login." };
  }
  if (url.searchParams.has("error")) {
    return { _tag: "Denied" };
  }
  const code = singleParam(url, "code");
  return code === null
    ? { _tag: "Invalid", reason: "The redirect URL is missing its authorization code." }
    : { _tag: "Code", code };
}

/**
 * Validates a redirect URL pasted back from a browser that could not reach
 * this machine's loopback listener (remote clients, phones).
 */
export function readPastedNotionCallback(
  pasted: string,
  expectedState: string,
): NotionCallbackResult {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return { _tag: "Invalid", reason: "Paste the full URL from the browser's address bar." };
  }
  const expected = new URL(NOTION_REDIRECT_URI);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    return {
      _tag: "Invalid",
      reason: `Paste the URL that starts with ${NOTION_REDIRECT_URI}.`,
    };
  }
  return readNotionCallback(url, expectedState);
}
