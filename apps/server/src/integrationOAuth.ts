import * as Option from "effect/Option";

/**
 * Where an integration's OAuth redirect lands. By default that is a fixed
 * loopback port, which only a browser on the server's machine can reach. A
 * server reachable over https (Tailscale, a tunnel) can instead register
 * `<origin>/oauth/<integration>/callback` with the provider and name that URI
 * in an environment variable; the main HTTP server then receives the redirect
 * from any device. The provider must allow this URI on the OAuth app.
 */
export type IntegrationRedirect =
  | { readonly _tag: "Loopback"; readonly uri: string }
  | { readonly _tag: "Server"; readonly uri: string }
  | { readonly _tag: "Invalid"; readonly reason: string };

export function resolveIntegrationRedirect(input: {
  readonly configured: Option.Option<string>;
  readonly variable: string;
  readonly loopbackUri: string;
  readonly callbackPath: string;
}): IntegrationRedirect {
  const configured = Option.getOrElse(input.configured, () => "").trim();
  if (configured === "") return { _tag: "Loopback", uri: input.loopbackUri };
  const invalid = {
    _tag: "Invalid",
    reason: `${input.variable} must be an https URL ending in ${input.callbackPath}.`,
  } as const;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return invalid;
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== input.callbackPath ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    return invalid;
  }
  return { _tag: "Server", uri: url.toString() };
}

/** What the browser sees after an OAuth redirect reaches the server. */
export interface CallbackReply {
  readonly status: number;
  readonly message: string;
}
