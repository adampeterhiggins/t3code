import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { settleMainDestination, type MainDestinationNavigation } from "./mainDestinationNavigation";

const thread = {
  environmentId: EnvironmentId.make("env-local"),
  threadId: ThreadId.make("thread-1"),
} satisfies ScopedThreadRef;

function createDestinationRouter(input: {
  readonly authenticated: boolean;
  readonly failUsage?: boolean;
  readonly holdUsage?: Promise<void>;
  readonly onUsageWaiting?: () => void;
}) {
  const root = createRootRoute();
  const home = createRoute({ getParentRoute: () => root, path: "/" });
  const pair = createRoute({ getParentRoute: () => root, path: "/pair" });
  const usage = createRoute({
    getParentRoute: () => root,
    path: "/usage",
    beforeLoad: async () => {
      if (input.holdUsage) {
        input.onUsageWaiting?.();
        await input.holdUsage;
      }
      if (input.failUsage) throw new Error("usage failed");
      if (!input.authenticated) throw redirect({ to: "/pair", replace: true });
    },
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    beforeLoad: ({ location }) => {
      if (!input.authenticated) throw redirect({ to: "/pair", replace: true });
      if (location.pathname === "/settings") {
        throw redirect({ to: "/settings/general", replace: true });
      }
    },
  });
  const general = createRoute({ getParentRoute: () => settings, path: "general" });
  const settingsProjects = createRoute({ getParentRoute: () => settings, path: "projects" });
  const project = createRoute({
    getParentRoute: () => root,
    path: "/projects/$projectKey",
    beforeLoad: ({ params }) => {
      throw redirect({
        to: "/settings/projects",
        search: { project: params.projectKey },
        replace: true,
      });
    },
  });
  const chat = createRoute({
    getParentRoute: () => root,
    id: "/_chat",
    beforeLoad: () => {
      if (!input.authenticated) throw redirect({ to: "/pair", replace: true });
    },
  });
  const threadRoute = createRoute({
    getParentRoute: () => chat,
    path: "/$environmentId/$threadId",
  });
  const router = createRouter({
    routeTree: root.addChildren([
      home,
      pair,
      usage,
      settings.addChildren([general, settingsProjects]),
      project,
      chat.addChildren([threadRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return router;
}

function adapt(router: AnyRouter): MainDestinationNavigation & { readonly calls: object[] } {
  const calls: object[] = [];
  return {
    calls,
    navigate: (options) => {
      calls.push(options);
      return router.navigate(options as never);
    },
    getState: () => {
      const redirect = router.state.redirect;
      return {
        location: {
          href: router.state.location.href,
          pathname: router.state.location.pathname,
        },
        ...(redirect === undefined ? {} : { redirect }),
        statusCode: router.state.statusCode,
        matches: router.state.matches.map((match) => ({
          status: match.status,
          pathname: match.pathname,
        })),
      };
    },
  };
}

describe("main destination navigation", () => {
  it("acks an opened thread only after the route has committed", async () => {
    let release: (value?: void) => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markWaiting: (value?: void) => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    const router = createDestinationRouter({
      authenticated: true,
      holdUsage: hold,
      onUsageWaiting: markWaiting,
    });
    await router.load();
    const navigation = adapt(router);
    let settled = false;
    const pending = settleMainDestination(
      { requestId: "req-hold", href: "/usage" },
      navigation,
    ).then((result) => {
      settled = true;
      return result;
    });

    await waiting;
    expect(settled).toBe(false);
    expect(navigation.calls).toHaveLength(1);
    expect(router.state.location.pathname).toBe("/usage");

    release();
    await expect(pending).resolves.toEqual({
      requestId: "req-hold",
      status: "opened",
      settledHref: "/usage",
    });
    expect(router.state.location.pathname).toBe("/usage");
  });

  it("reports a settled thread as opened and an auth redirect as redirected", async () => {
    const openedRouter = createDestinationRouter({ authenticated: true });
    await openedRouter.load();
    const opened = await settleMainDestination(
      { requestId: "req-thread", thread },
      adapt(openedRouter),
    );
    expect(opened).toEqual({
      requestId: "req-thread",
      status: "opened",
      settledHref: "/env-local/thread-1",
    });

    const signedOut = createDestinationRouter({ authenticated: false });
    await signedOut.load();
    const redirected = await settleMainDestination(
      { requestId: "req-auth", thread },
      adapt(signedOut),
    );
    expect(redirected).toEqual({
      requestId: "req-auth",
      status: "redirected",
      settledHref: "/pair",
    });
    expect(signedOut.state.location.pathname).toBe("/pair");
  });

  it("reports a settings index redirect and a direct settings page accurately", async () => {
    const router = createDestinationRouter({ authenticated: true });
    await router.load();
    const navigation = adapt(router);

    await expect(
      settleMainDestination({ requestId: "req-index", href: "/settings" }, navigation),
    ).resolves.toEqual({
      requestId: "req-index",
      status: "redirected",
      settledHref: "/settings/general",
    });

    await expect(
      settleMainDestination({ requestId: "req-general", href: "/settings/general" }, navigation),
    ).resolves.toEqual({
      requestId: "req-general",
      status: "opened",
      settledHref: "/settings/general",
    });

    await expect(
      settleMainDestination({ requestId: "req-usage", href: "/usage" }, navigation),
    ).resolves.toEqual({
      requestId: "req-usage",
      status: "opened",
      settledHref: "/usage",
    });
  });

  it("follows a project page into settings and fails a route that errors", async () => {
    const router = createDestinationRouter({ authenticated: true });
    await router.load();
    const moved = await settleMainDestination(
      { requestId: "req-project", href: "/projects/repo" },
      adapt(router),
    );
    expect(moved.status).toBe("redirected");
    expect(moved.settledHref?.startsWith("/settings/projects")).toBe(true);

    const failing = createDestinationRouter({ authenticated: true, failUsage: true });
    await failing.load();
    await expect(
      settleMainDestination({ requestId: "req-fail", href: "/usage" }, adapt(failing)),
    ).resolves.toEqual({ requestId: "req-fail", status: "failed" });
  });

  it("fails a surfaced automation seed without navigating", async () => {
    const router = createDestinationRouter({ authenticated: true });
    await router.load();
    const navigation = adapt(router);
    await expect(
      settleMainDestination(
        { requestId: "req-seed", href: "/settings/scheduled-tasks?scheduledTaskSeed=1" },
        navigation,
      ),
    ).resolves.toEqual({ requestId: "req-seed", status: "failed" });
    expect(navigation.calls).toEqual([]);
    expect(router.state.location.pathname).toBe("/");
  });
});
