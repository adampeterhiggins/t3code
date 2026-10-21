import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId } from "./baseSchemas.ts";

import {
  classifyDesktopMainDestinationPath,
  desktopMainDestinationSeedFailure,
  DesktopMainDestinationRequest,
  isDesktopMainDestinationHref,
} from "./desktopMainDestination.ts";

const decode = Schema.decodeUnknownSync(DesktopMainDestinationRequest);

describe("desktop main destination", () => {
  it("accepts a thread ref or a relative in-app href", () => {
    expect(
      decode({
        requestId: "req-thread",
        thread: {
          environmentId: EnvironmentId.make("env-local"),
          threadId: ThreadId.make("thread-1"),
        },
      }),
    ).toMatchObject({ requestId: "req-thread" });
    expect(
      decode({ requestId: "req-href", href: "/settings/general?machine=local#theme" }),
    ).toEqual({
      requestId: "req-href",
      href: "/settings/general?machine=local#theme",
    });
  });

  it("rejects external, protocol-relative, and unknown paths", () => {
    for (const href of [
      "https://example.com/settings",
      "//example.com/settings",
      "/\\settings",
      "/settings/not-a-section",
      "/nope",
      "/draft",
      "/a/b/c",
      "settings/general",
      "/settings/general?seed=prompt",
    ]) {
      expect(isDesktopMainDestinationHref(href), href).toBe(false);
      expect(() => decode({ requestId: "req", href })).toThrow();
    }
  });

  it("classifies floating chat, full-app pages, and junk", () => {
    expect(classifyDesktopMainDestinationPath("/")).toBe("chat");
    expect(classifyDesktopMainDestinationPath("/new")).toBe("chat");
    expect(classifyDesktopMainDestinationPath("/draft/draft-1")).toBe("chat");
    expect(classifyDesktopMainDestinationPath("/env-local/thread-1")).toBe("chat");
    expect(classifyDesktopMainDestinationPath("/settings")).toBe("app");
    expect(classifyDesktopMainDestinationPath("/settings/projects")).toBe("app");
    expect(classifyDesktopMainDestinationPath("/projects/repository:t3")).toBe("app");
    expect(classifyDesktopMainDestinationPath("/usage")).toBe("app");
    expect(classifyDesktopMainDestinationPath("/pull-requests")).toBe("app");
    expect(classifyDesktopMainDestinationPath("/not-a-page")).toBe("unknown");
  });

  it("reports a surfaced automation seed as a failure instead of dropping it", () => {
    expect(desktopMainDestinationSeedFailure({ requestId: "req", href: "/usage" })).toBeNull();
    expect(
      desktopMainDestinationSeedFailure({
        requestId: " req ",
        href: "/settings/scheduled-tasks",
        seed: { prompt: "nightly" },
      }),
    ).toEqual({ requestId: "req", status: "failed" });
    expect(
      desktopMainDestinationSeedFailure({
        href: "/settings/scheduled-tasks?scheduledTaskSeed=1",
      }),
    ).toEqual({ requestId: "invalid-request", status: "failed" });
  });
});
