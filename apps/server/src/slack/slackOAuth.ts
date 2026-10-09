import { SLACK_REDIRECT_URI, SLACK_USER_SCOPES } from "@t3tools/contracts";

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_API_URL = "https://slack.com/api";

/**
 * Slack matches redirect URIs exactly, port included, so the loopback listener
 * has one fixed port that must stay registered on the Slack app. Slack only
 * treats `localhost` redirects as desktop (PKCE) redirects, so the URI names
 * `localhost` while the listener binds 127.0.0.1.
 */
export const SLACK_LOOPBACK_PORT = 47832;
export const SLACK_SERVER_CALLBACK_PATH = "/oauth/slack/callback";

export function buildSlackAuthorizeUrl(input: {
  readonly clientId: string;
  readonly redirectUri?: string;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? SLACK_REDIRECT_URI,
    // Desktop redirects cannot request bot scopes.
    scope: "",
    user_scope: SLACK_USER_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export type SlackCallbackResult =
  | { readonly _tag: "Code"; readonly code: string }
  | { readonly _tag: "Denied" }
  | { readonly _tag: "Invalid"; readonly reason: string };

function singleParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

/** Reads the loopback callback query. `state` must match the flow exactly once. */
export function readSlackCallback(url: URL, expectedState: string): SlackCallbackResult {
  if (singleParam(url, "state") !== expectedState) {
    return { _tag: "Invalid", reason: "The sign-in link does not belong to this Slack login." };
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
export function readPastedSlackCallback(
  pasted: string,
  expectedState: string,
  redirectUri: string = SLACK_REDIRECT_URI,
): SlackCallbackResult {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return { _tag: "Invalid", reason: "Paste the full URL from the browser's address bar." };
  }
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    return {
      _tag: "Invalid",
      reason: `Paste the URL that starts with ${redirectUri}.`,
    };
  }
  return readSlackCallback(url, expectedState);
}
