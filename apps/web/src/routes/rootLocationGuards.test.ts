import { DesktopMainDestinationRequest } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  isRedirect,
} from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { guardDesktopRootLocation } from "./rootLocationGuards";

const decodeRequest = Schema.decodeUnknownSync(DesktopMainDestinationRequest);

function load(input: {
  readonly detached: boolean;
  readonly pathname: string;
  readonly pendingAutomationSeed?: boolean;
}) {
  const mounted: string[] = [];
  let passedGuard = false;
  const root = createRootRoute({
    beforeLoad: ({ location }) => {
      guardDesktopRootLocation({
        isQuickMessageWindow: true,
        isDetachedChatWindow: input.detached,
        pathname: location.pathname,
        href: location.href,
        pendingAutomationSeed: input.pendingAutomationSeed === true,
      });
      passedGuard = true;
    },
  });
  const mount = (name: string) => () => {
    mounted.push(name);
  };
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/",
    beforeLoad: mount("chat"),
  });
  const draft = createRoute({
    getParentRoute: () => root,
    path: "/draft/$draftId",
    beforeLoad: mount("draft"),
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings/general",
    beforeLoad: mount("settings"),
  });
  const scheduled = createRoute({
    getParentRoute: () => root,
    path: "/settings/scheduled-tasks",
    beforeLoad: mount("scheduled"),
  });
  const pair = createRoute({
    getParentRoute: () => root,
    path: "/pair",
    beforeLoad: mount("pair"),
  });
  const connect = createRoute({
    getParentRoute: () => root,
    path: "/connect",
    beforeLoad: mount("connect"),
  });
  const router = createRouter({
    routeTree: root.addChildren([chat, draft, settings, scheduled, pair, connect]),
    history: createMemoryHistory({ initialEntries: [input.pathname] }),
  });
  return { router, mounted, passedGuard: () => passedGuard };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("desktop root location guards", () => {
  it("hands a non-chat route to the main window before auth or child routes", async () => {
    const opened: unknown[] = [];
    vi.stubGlobal("window", {
      desktopBridge: {
        openMainDestination: (request: unknown) => {
          opened.push(request);
          return Promise.resolve({
            requestId: (request as { requestId: string }).requestId,
            status: "opened",
          });
        },
      },
    });
    const { router, mounted, passedGuard } = load({
      detached: true,
      pathname: "/settings/general",
    });

    await router.load();
    expect(router.state.statusCode).toBe(404);

    expect(passedGuard()).toBe(false);
    expect(mounted).toEqual([]);
    expect(opened).toHaveLength(1);
    expect(decodeRequest(opened[0])).toMatchObject({ href: "/settings/general" });
    expect(opened[0]).not.toHaveProperty("thread");
  });

  it("toasts a missing bridge instead of sending an invalid request", async () => {
    const add = vi.spyOn(toastManager, "add").mockImplementation(() => "toast");
    vi.stubGlobal("window", {});
    const { router, mounted } = load({ detached: true, pathname: "/pair" });

    await router.load();
    expect(router.state.statusCode).toBe(404);
    await Promise.resolve();
    await Promise.resolve();

    expect(mounted).toEqual([]);
    expect(add).toHaveBeenCalled();
    expect(add.mock.calls[0]?.[0]).toMatchObject({
      title: "Couldn't open the main window",
    });
  });

  it("reports a seeded automation instead of handing it over", async () => {
    const opened: unknown[] = [];
    const add = vi.spyOn(toastManager, "add").mockImplementation(() => "toast");
    vi.stubGlobal("window", {
      desktopBridge: {
        openMainDestination: (request: unknown) => {
          opened.push(request);
          return Promise.resolve({ requestId: "nope", status: "opened" });
        },
      },
    });
    const { router } = load({
      detached: true,
      pathname: "/settings/scheduled-tasks?scheduledTaskSeed=1",
    });

    await router.load();
    expect(router.state.statusCode).toBe(404);
    await Promise.resolve();

    expect(opened).toEqual([]);
    expect(add.mock.calls.map((call) => call[0])).toContainEqual(
      expect.objectContaining({ title: "Couldn't move this automation" }),
    );
  });

  it("lets an isolated chat route reach its child after the guard", async () => {
    const { router, mounted, passedGuard } = load({
      detached: true,
      pathname: "/draft/draft-1",
    });

    await router.load();

    expect(passedGuard()).toBe(true);
    expect(mounted).toEqual(["draft"]);
    expect(router.state.location.pathname).toBe("/draft/draft-1");
  });

  it("keeps the legacy panel off chat routes without a handoff", async () => {
    const opened: unknown[] = [];
    vi.stubGlobal("window", {
      desktopBridge: {
        openMainDestination: (request: unknown) => {
          opened.push(request);
          return Promise.resolve({ requestId: "nope", status: "opened" });
        },
      },
    });
    const { router, mounted, passedGuard } = load({
      detached: false,
      pathname: "/settings/general",
    });

    await router.load();
    expect(isRedirect(router.state.redirect)).toBe(true);
    expect(passedGuard()).toBe(false);
    expect(mounted).toEqual([]);
    expect(opened).toEqual([]);
  });
});
