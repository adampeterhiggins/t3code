export const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

/**
 * Linear matches redirect URIs exactly, port included, so the loopback
 * listener has one fixed port that must stay registered on the OAuth app.
 */
export const LINEAR_LOOPBACK_PORT = 47831;
export const LINEAR_REDIRECT_URI = `http://127.0.0.1:${LINEAR_LOOPBACK_PORT}/callback`;
/** The main server's callback, for a `T3CODE_LINEAR_REDIRECT_URI` registered on the app. */
export const LINEAR_SERVER_CALLBACK_PATH = "/oauth/linear/callback";

/**
 * The fork's public PKCE client. It carries no secret; forks registering
 * their own Linear app override it with `T3CODE_LINEAR_CLIENT_ID`.
 */
export const DEFAULT_LINEAR_CLIENT_ID = "56a88f61b2b549a59361a1846f680e7e";

export function buildLinearAuthorizeUrl(input: {
  readonly clientId: string;
  readonly redirectUri?: string;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(LINEAR_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? LINEAR_REDIRECT_URI,
    response_type: "code",
    scope: "read",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  return url.toString();
}

export type LinearCallbackResult =
  | { readonly _tag: "Code"; readonly code: string }
  | { readonly _tag: "Denied" }
  | { readonly _tag: "Invalid"; readonly reason: string };

function singleParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

/** Reads the redirect's query. `state` must match the flow exactly once. */
export function readLinearCallback(url: URL, expectedState: string): LinearCallbackResult {
  if (singleParam(url, "state") !== expectedState) {
    return { _tag: "Invalid", reason: "The sign-in link does not belong to this Linear login." };
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
 * the redirect URI (remote clients, phones).
 */
export function readPastedLinearCallback(
  pasted: string,
  expectedState: string,
  redirectUri: string = LINEAR_REDIRECT_URI,
): LinearCallbackResult {
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
  return readLinearCallback(url, expectedState);
}
