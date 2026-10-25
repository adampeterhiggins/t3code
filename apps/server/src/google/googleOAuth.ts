const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Google matches redirect URIs exactly, port included, so the loopback
 * listener has one fixed port that must stay registered on the OAuth app.
 */
export const GOOGLE_LOOPBACK_PORT = 47834;
import { GOOGLE_REDIRECT_URI } from "@t3tools/contracts";
export { GOOGLE_REDIRECT_URI };
/** The main server's callback, for a `T3CODE_GOOGLE_REDIRECT_URI` registered on the connection. */
export const GOOGLE_SERVER_CALLBACK_PATH = "/oauth/google/callback";

export function buildGoogleAuthorizeUrl(input: {
  readonly clientId: string;
  readonly redirectUri?: string;
  readonly state: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/directory.readonly",
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  }).toString();
  return url.toString();
}

export type GoogleCallbackResult =
  | { readonly _tag: "Code"; readonly code: string }
  | { readonly _tag: "Denied" }
  | { readonly _tag: "Invalid"; readonly reason: string };

function singleParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

/** Reads the redirect's query. `state` must match the flow exactly once. */
export function readGoogleCallback(url: URL, expectedState: string): GoogleCallbackResult {
  if (singleParam(url, "state") !== expectedState) {
    return { _tag: "Invalid", reason: "The sign-in link does not belong to this Google login." };
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
export function readPastedGoogleCallback(
  pasted: string,
  expectedState: string,
  redirectUri: string = GOOGLE_REDIRECT_URI,
): GoogleCallbackResult {
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
  return readGoogleCallback(url, expectedState);
}
