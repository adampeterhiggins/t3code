import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { guardIsolatedFloatingWindow } from "./isolatedFloatingRootGuard";

function visit(input: {
  readonly pathname: string;
  readonly href?: string;
  readonly pendingAutomationSeed?: boolean;
}) {
  const handed: string[] = [];
  let seedFailures = 0;
  let thrown: unknown;
  try {
    guardIsolatedFloatingWindow({
      isDetachedChatWindow: true,
      pathname: input.pathname,
      href: input.href ?? input.pathname,
      ...(input.pendingAutomationSeed === undefined
        ? {}
        : { pendingAutomationSeed: input.pendingAutomationSeed }),
      handoff: (href) => {
        handed.push(href);
      },
      onSeedFailure: () => {
        seedFailures += 1;
      },
    });
  } catch (error) {
    thrown = error;
  }
  return { handed, seedFailures, thrown };
}

describe("isolated floating root guard", () => {
  it("leaves chat routes mounted", () => {
    for (const pathname of ["/", "/new", "/draft/draft-1", "/env-local/thread-1"]) {
      const result = visit({ pathname });
      expect(result.thrown, pathname).toBeUndefined();
      expect(result.handed, pathname).toEqual([]);
    }
  });

  it("hands a non-chat app route to the main window and refuses to mount it", () => {
    for (const pathname of ["/settings/general", "/projects/repo", "/usage", "/pair"]) {
      const result = visit({ pathname });
      expect(isNotFound(result.thrown), pathname).toBe(true);
      expect(result.handed, pathname).toEqual([pathname]);
    }
  });

  it("does not forward an unknown path", () => {
    const result = visit({ pathname: "/not-a-page" });
    expect(isNotFound(result.thrown)).toBe(true);
    expect(result.handed).toEqual([]);
  });

  it("reports a surfaced automation seed instead of handing it over", () => {
    const result = visit({
      pathname: "/settings/scheduled-tasks",
      href: "/settings/scheduled-tasks?scheduledTaskSeed=1",
    });
    expect(isNotFound(result.thrown)).toBe(true);
    expect(result.handed).toEqual([]);
    expect(result.seedFailures).toBe(1);
  });
});
