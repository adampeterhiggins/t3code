import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  classifyFloatingDestination,
  installFloatingNavigationBlocker,
} from "./floatingNavigation";

const primary = {
  primaryEnvironmentId: "env-local",
  pendingAutomationSeed: false,
};

describe("floating navigation", () => {
  it("hands settings, projects, and usage to the main window", () => {
    expect(classifyFloatingDestination({ pathname: "/settings/general", ...primary }).action).toBe(
      "handoff",
    );
    expect(classifyFloatingDestination({ pathname: "/projects/repo", ...primary }).action).toBe(
      "handoff",
    );
    expect(classifyFloatingDestination({ pathname: "/usage", ...primary }).action).toBe("handoff");
    expect(classifyFloatingDestination({ pathname: "/not-a-page", ...primary }).action).toBe(
      "reject",
    );
  });

  it("allows the floating chat, including a query, and blocks everything else in place", async () => {
    expect(
      classifyFloatingDestination({
        pathname: "/env-local/thread-1",
        search: "?keep=1",
        ...primary,
      }).action,
    ).toBe("allow");
    expect(classifyFloatingDestination({ pathname: "/draft/draft-1", ...primary }).action).toBe(
      "allow",
    );
    expect(classifyFloatingDestination({ pathname: "/", search: "?q=1", ...primary }).action).toBe(
      "allow",
    );

    // Blockers run only when `document` exists. A blocked push never notifies
    // subscribers, so a router waiting on that notification would stay pending.
    // An allowed push still notifies, which is what an awaited navigation needs.
    vi.stubGlobal("document", {});
    try {
      const history = createMemoryHistory({ initialEntries: ["/draft/draft-1"] });
      const handed: string[] = [];
      let commits = 0;
      history.subscribe(() => {
        commits += 1;
      });
      installFloatingNavigationBlocker(history, () => primary, {
        handoff: (href) => handed.push(href),
        onFail: () => undefined,
      });

      history.push("/settings/general");
      history.push("/projects/repo");
      history.push("/usage");
      history.push("/not-a-page");
      await Promise.resolve();

      expect(history.location.pathname).toBe("/draft/draft-1");
      expect(commits).toBe(0);
      expect(handed).toEqual(["/settings/general", "/projects/repo", "/usage"]);

      history.push("/draft/draft-2");
      history.push("/env-local/thread-1?keep=1");
      await Promise.resolve();
      expect(history.location.pathname).toBe("/env-local/thread-1");
      expect(history.location.search).toBe("?keep=1");
      expect(commits).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
