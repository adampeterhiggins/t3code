import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ScopedThreadRef } from "./environment.ts";

const MAX_HREF_LENGTH = 2048;
const SEED_KEYS = new Set(["seed", "scheduledTaskSeed"]);

/**
 * Settings children that exist as routes. An unknown settings section is not
 * forwarded: the floating window must not hand the main window a 404.
 */
const SETTINGS_SECTIONS = new Set([
  "appearance",
  "archived",
  "connections",
  "diagnostics",
  "general",
  "integrations",
  "keybindings",
  "open-source-licenses",
  "organisations",
  "projects",
  "providers",
  "scheduled-tasks",
  "snap-shot",
  "source-control",
  "storage",
]);

const APP_EXACT = new Set([
  "connect",
  "connect-agent",
  "pair",
  "pull-requests",
  "quick-message",
  "usage",
  "welcome",
]);

const RESERVED_FIRST = new Set([
  "connect",
  "connect-agent",
  "draft",
  "new",
  "pair",
  "projects",
  "pull-requests",
  "quick-message",
  "settings",
  "usage",
  "welcome",
]);

export type DesktopMainDestinationPathKind = "chat" | "app" | "unknown";

export interface DesktopMainDestinationHrefParts {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export const DesktopMainDestinationStatus = Schema.Literals(["opened", "redirected", "failed"]);
export type DesktopMainDestinationStatus = typeof DesktopMainDestinationStatus.Type;

const isInternalHref = Schema.makeFilter((value: string) => isDesktopMainDestinationHref(value), {
  expected: "an internal T3 Code route",
  toJsonSchema: () => [{ minLength: 1, maxLength: MAX_HREF_LENGTH }, true],
  arbitraryConstraint: { minLength: 1, maxLength: MAX_HREF_LENGTH },
});

const DesktopMainDestinationHref = Schema.String.check(isInternalHref);

export const DesktopMainDestinationThreadRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  thread: ScopedThreadRef,
});
export type DesktopMainDestinationThreadRequest = typeof DesktopMainDestinationThreadRequest.Type;

export const DesktopMainDestinationLocationRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  href: DesktopMainDestinationHref,
});
export type DesktopMainDestinationLocationRequest =
  typeof DesktopMainDestinationLocationRequest.Type;

export const DesktopMainDestinationRequest = Schema.Union([
  DesktopMainDestinationThreadRequest,
  DesktopMainDestinationLocationRequest,
]);
export type DesktopMainDestinationRequest = typeof DesktopMainDestinationRequest.Type;

export const DesktopMainDestinationResult = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  status: DesktopMainDestinationStatus,
  settledHref: Schema.optional(Schema.String),
});
export type DesktopMainDestinationResult = typeof DesktopMainDestinationResult.Type;

function normalizePathname(pathname: string): string | null {
  if (pathname.length === 0 || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return null;
  }
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (trimmed.includes("//")) return null;
  return trimmed;
}

function segmentsOf(pathname: string): ReadonlyArray<string> | null {
  const normalized = normalizePathname(pathname);
  if (normalized === null) return null;
  if (normalized === "/") return [];
  const segments: Array<string> = [];
  for (const segment of normalized.slice(1).split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      // oxlint-disable-next-line no-control-regex -- a destination path cannot carry ASCII controls
      /[\u0000-\u001f]/.test(decoded)
    ) {
      return null;
    }
    segments.push(decoded);
  }
  return segments;
}

export function parseDesktopMainDestinationHref(
  href: string,
): DesktopMainDestinationHrefParts | null {
  if (href.length === 0 || href.length > MAX_HREF_LENGTH) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  // oxlint-disable-next-line no-control-regex -- a destination href cannot carry ASCII controls
  if (href.includes("\\") || href.includes("://") || /[\u0000-\u001f\s]/.test(href)) return null;

  const hashIndex = href.indexOf("#");
  const beforeHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const searchIndex = beforeHash.indexOf("?");
  const pathname = searchIndex === -1 ? beforeHash : beforeHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? "" : beforeHash.slice(searchIndex);
  const normalized = normalizePathname(pathname);
  if (normalized === null || segmentsOf(normalized) === null) return null;
  return { pathname: normalized, search, hash };
}

export function classifyDesktopMainDestinationPath(
  pathname: string,
): DesktopMainDestinationPathKind {
  const segments = segmentsOf(pathname);
  if (segments === null) return "unknown";
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "new")) return "chat";
  if (segments[0] === "draft" && segments.length === 2) return "chat";
  if (
    segments[0] === "settings" &&
    (segments.length === 1 || (segments.length === 2 && SETTINGS_SECTIONS.has(segments[1]!)))
  ) {
    return "app";
  }
  if (segments[0] === "projects" && segments.length === 2) return "app";
  if (segments.length === 1 && APP_EXACT.has(segments[0]!)) return "app";
  if (segments.length === 2 && !RESERVED_FIRST.has(segments[0]!)) return "chat";
  return "unknown";
}

/** Environment id of `/$environmentId/$threadId`, when that path is a thread route. */
export function desktopMainDestinationThreadEnvironmentId(pathname: string): string | null {
  const segments = segmentsOf(pathname);
  if (segments === null || segments.length !== 2 || RESERVED_FIRST.has(segments[0]!)) return null;
  return segments[0]!;
}

export function desktopMainDestinationHrefCarriesSeed(href: string): boolean {
  const parsed = parseDesktopMainDestinationHref(href);
  if (parsed === null) {
    return /(?:\?|&)(?:seed|scheduledTaskSeed)(?:=|&|$)/.test(href);
  }
  const params = new URLSearchParams(parsed.search);
  for (const key of params.keys()) {
    if (SEED_KEYS.has(key)) return true;
  }
  return false;
}

export function desktopMainDestinationCarriesSeed(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("seed" in value || "scheduledTaskSeed" in value) return true;
  if (
    "href" in value &&
    typeof value.href === "string" &&
    desktopMainDestinationHrefCarriesSeed(value.href)
  ) {
    return true;
  }
  return false;
}

export function desktopMainDestinationRequestId(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    value.requestId.trim().length > 0
  ) {
    return value.requestId.trim();
  }
  return "invalid-request";
}

/** A surfaced automation seed is a failure. The first version does not transfer it. */
export function desktopMainDestinationSeedFailure(
  value: unknown,
): DesktopMainDestinationResult | null {
  if (!desktopMainDestinationCarriesSeed(value)) return null;
  return {
    requestId: desktopMainDestinationRequestId(value),
    status: "failed",
  };
}

export function isDesktopMainDestinationHref(href: string): boolean {
  const parsed = parseDesktopMainDestinationHref(href);
  if (parsed === null || desktopMainDestinationHrefCarriesSeed(href)) return false;
  const kind = classifyDesktopMainDestinationPath(parsed.pathname);
  return kind === "chat" || kind === "app";
}

export function joinDesktopMainDestinationHref(parts: DesktopMainDestinationHrefParts): string {
  return `${parts.pathname}${parts.search}${parts.hash}`;
}
