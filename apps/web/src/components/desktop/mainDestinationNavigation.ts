import {
  classifyDesktopMainDestinationPath,
  desktopMainDestinationHrefCarriesSeed,
  joinDesktopMainDestinationHref,
  parseDesktopMainDestinationHref,
  type DesktopMainDestinationRequest,
  type DesktopMainDestinationResult,
} from "@t3tools/contracts";

import { buildThreadRouteParams, isThreadRoutePathname } from "../../threadRoutes";

interface DestinationLocation {
  readonly href: string;
  readonly pathname: string;
}

interface DestinationMatch {
  readonly status: string;
  readonly pathname?: string;
}

export interface MainDestinationNavigation {
  navigate: (options: object) => Promise<unknown>;
  getState: () => {
    readonly location: DestinationLocation;
    readonly redirect?: { readonly options?: object };
    readonly statusCode: number;
    readonly matches: ReadonlyArray<DestinationMatch>;
  };
}

const REDIRECT_HOPS = 4;

function failed(requestId: string): DesktopMainDestinationResult {
  return { requestId, status: "failed" };
}

function canonicalPathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function canonicalHref(href: string): string | null {
  const parsed = parseDesktopMainDestinationHref(href);
  return parsed === null ? null : joinDesktopMainDestinationHref(parsed);
}

function redirectTargetPath(options: object | undefined): string | null {
  if (options === undefined) return null;
  const to = "to" in options && typeof options.to === "string" ? options.to : null;
  if (to !== null && to.startsWith("/")) {
    return parseDesktopMainDestinationHref(to)?.pathname ?? null;
  }
  const href = "href" in options && typeof options.href === "string" ? options.href : null;
  if (href === null) return null;
  return parseDesktopMainDestinationHref(href)?.pathname ?? null;
}

/**
 * A beforeLoad redirect stays on `state.redirect` after it has been followed,
 * including across later navigations. Follow only a record this navigation
 * just produced, and only until the location reaches that target.
 */
async function followRecordedRedirects(
  navigation: MainDestinationNavigation,
  redirectBeforeNavigation: ReturnType<MainDestinationNavigation["getState"]>["redirect"],
): Promise<void> {
  let previousHref = navigation.getState().location.href;
  for (let hop = 0; hop < REDIRECT_HOPS; hop += 1) {
    const state = navigation.getState();
    if (hop === 0 && state.redirect === redirectBeforeNavigation) return;
    const options = state.redirect?.options;
    const target = redirectTargetPath(options);
    if (options === undefined) return;
    if (target !== null && canonicalPathname(state.location.pathname) === target) return;
    await navigation.navigate({ ...options, replace: true, ignoreBlocker: true });
    const nextHref = navigation.getState().location.href;
    if (nextHref === previousHref) return;
    previousHref = nextHref;
  }
}

function loadFailed(state: ReturnType<MainDestinationNavigation["getState"]>): boolean {
  if (state.statusCode === 404 || state.statusCode === 500) return true;
  const leaf = state.matches[state.matches.length - 1];
  if (leaf === undefined) return true;
  if (leaf.status === "error" || leaf.status === "notFound" || leaf.status === "pending") {
    return true;
  }
  if (
    leaf.pathname !== undefined &&
    canonicalPathname(leaf.pathname) !== canonicalPathname(state.location.pathname)
  ) {
    return true;
  }
  return false;
}

function settledHref(location: DestinationLocation): string {
  return canonicalHref(location.href) ?? canonicalHref(location.pathname) ?? location.pathname;
}

function classifySettled(
  request: DesktopMainDestinationRequest,
  state: ReturnType<MainDestinationNavigation["getState"]>,
): DesktopMainDestinationResult {
  const href = settledHref(state.location);
  const pathname = canonicalPathname(state.location.pathname);
  if ("thread" in request) {
    if (isThreadRoutePathname(pathname, request.thread)) {
      return { requestId: request.requestId, status: "opened", settledHref: href };
    }
    const kind = classifyDesktopMainDestinationPath(pathname);
    if (kind === "unknown") return failed(request.requestId);
    return { requestId: request.requestId, status: "redirected", settledHref: href };
  }
  const requested = canonicalHref(request.href);
  if (requested !== null && requested === href) {
    return { requestId: request.requestId, status: "opened", settledHref: href };
  }
  const kind = classifyDesktopMainDestinationPath(pathname);
  if (kind === "unknown") return failed(request.requestId);
  return { requestId: request.requestId, status: "redirected", settledHref: href };
}

/** Navigates, waits until that navigation has committed, then classifies it once. */
export async function settleMainDestination(
  request: DesktopMainDestinationRequest,
  navigation: MainDestinationNavigation,
): Promise<DesktopMainDestinationResult> {
  if ("href" in request && desktopMainDestinationHrefCarriesSeed(request.href)) {
    return failed(request.requestId);
  }
  try {
    const redirectBeforeNavigation = navigation.getState().redirect;
    if ("thread" in request) {
      await navigation.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(request.thread),
      });
    } else {
      await navigation.navigate({ href: request.href });
    }
    await followRecordedRedirects(navigation, redirectBeforeNavigation);
  } catch {
    return failed(request.requestId);
  }
  const state = navigation.getState();
  if (loadFailed(state)) return failed(request.requestId);
  return classifySettled(request, state);
}
