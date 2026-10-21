import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { redirectLegacyQuickMessageWindow } from "./legacyQuickMessageRootGuard";

// Desktop hash history exposes `#/draft/id` as pathname `/draft/id` before root
// beforeLoad. Memory history is that pathname without a DOM. Child beforeLoad
// stands in for mounting the route: the app's chat layout renders ChatView,
// which writes drafts. This router does not boot that shell.
//
// Vitest loads the server build of TanStack Router, which records a beforeLoad
// redirect instead of navigating. The client build navigates with the recorded
// options and forces replace; follow that once so the assertion is the landing
// pathname.
const unsafeHashes = [
  {
    hash: "#/env-1/thread-1",
    pathname: "/env-1/thread-1",
    mounts: ["chat", "thread"],
  },
  {
    hash: "#/draft/draft-1",
    pathname: "/draft/draft-1",
    mounts: ["chat", "draft"],
  },
  { hash: "#/settings", pathname: "/settings", mounts: ["settings"] },
  { hash: "#/pair", pathname: "/pair", mounts: ["pair"] },
] as const;

const legacyQuick = { isQuickMessageWindow: true, isDetachedChatWindow: false };
const isolatedQuick = { isQuickMessageWindow: true, isDetachedChatWindow: true };
const mainWindow = { isQuickMessageWindow: false, isDetachedChatWindow: false };

function loadHash(
  windowKind: {
    readonly isQuickMessageWindow: boolean;
    readonly isDetachedChatWindow: boolean;
  },
  pathname: string,
) {
  const mountedRoutes: Array<string> = [];
  const passedGuard: Array<string> = [];
  const root = createRootRoute({
    beforeLoad: ({ location }) => {
      redirectLegacyQuickMessageWindow({
        isQuickMessageWindow: windowKind.isQuickMessageWindow,
        isDetachedChatWindow: windowKind.isDetachedChatWindow,
        pathname: location.pathname,
      });
      passedGuard.push(location.pathname);
    },
  });
  const mount = (route: string) => () => {
    mountedRoutes.push(route);
  };
  const quickMessage = createRoute({
    getParentRoute: () => root,
    path: "/quick-message",
  });
  const chat = createRoute({
    getParentRoute: () => root,
    id: "/_chat",
    beforeLoad: mount("chat"),
  });
  const thread = createRoute({
    getParentRoute: () => chat,
    path: "/$environmentId/$threadId",
    beforeLoad: mount("thread"),
  });
  const draft = createRoute({
    getParentRoute: () => chat,
    path: "/draft/$draftId",
    beforeLoad: mount("draft"),
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    beforeLoad: mount("settings"),
  });
  const pair = createRoute({
    getParentRoute: () => root,
    path: "/pair",
    beforeLoad: mount("pair"),
  });
  const router = createRouter({
    routeTree: root.addChildren([quickMessage, chat.addChildren([thread, draft]), settings, pair]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  return { router, mountedRoutes, passedGuard };
}

async function followClientRedirect(router: AnyRouter) {
  const options = router.state.redirect?.options;
  if (!options || router.state.location.pathname === options.to) return;
  await router.navigate({
    ...options,
    replace: true,
    ignoreBlocker: true,
  });
}

describe("legacy quick-message root guard", () => {
  it.each(unsafeHashes)(
    "replaces $hash in a non-isolated quick window before that route can write drafts",
    async ({ pathname }) => {
      const { router, mountedRoutes, passedGuard } = loadHash(legacyQuick, pathname);
      await router.load();
      expect(mountedRoutes).toEqual([]);
      expect(passedGuard).toEqual([]);
      await followClientRedirect(router);

      expect(router.state.location.pathname).toBe("/quick-message");
      expect(router.history.length).toBe(1);
      expect(mountedRoutes).toEqual([]);
      expect(passedGuard).toEqual(["/quick-message"]);
    },
  );

  it("stays on the panel when the legacy window is already there", async () => {
    const { router, mountedRoutes, passedGuard } = loadHash(legacyQuick, "/quick-message");
    await router.load();
    await followClientRedirect(router);

    expect(router.state.location.pathname).toBe("/quick-message");
    expect(mountedRoutes).toEqual([]);
    expect(passedGuard).toEqual(["/quick-message"]);
  });

  it("replaces a later navigation away from the legacy panel", async () => {
    const { router, mountedRoutes } = loadHash(legacyQuick, "/quick-message");
    await router.load();

    await router.navigate({ to: "/draft/$draftId", params: { draftId: "draft-1" } });
    await followClientRedirect(router);
    expect(router.state.location.pathname).toBe("/quick-message");
    expect(mountedRoutes).toEqual([]);

    await router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-1" },
    });
    await followClientRedirect(router);
    expect(router.state.location.pathname).toBe("/quick-message");
    expect(mountedRoutes).toEqual([]);
  });

  it.each(unsafeHashes)(
    "leaves $hash in place for an isolated quick window",
    async ({ pathname, mounts }) => {
      const { router, mountedRoutes, passedGuard } = loadHash(isolatedQuick, pathname);
      await router.load();
      await followClientRedirect(router);

      expect(router.state.location.pathname).toBe(pathname);
      expect(mountedRoutes).toEqual([...mounts]);
      expect(passedGuard).toEqual([pathname]);
    },
  );

  it.each(unsafeHashes)(
    "leaves $hash in place for the main window",
    async ({ pathname, mounts }) => {
      const { router, mountedRoutes, passedGuard } = loadHash(mainWindow, pathname);
      await router.load();
      await followClientRedirect(router);

      expect(router.state.location.pathname).toBe(pathname);
      expect(mountedRoutes).toEqual([...mounts]);
      expect(passedGuard).toEqual([pathname]);
    },
  );
});
