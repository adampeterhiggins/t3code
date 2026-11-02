import { describe, expect, it, vi } from "vite-plus/test";

import {
  activateDetachedChatFrame,
  detachedChatShellPlan,
  isolatedFloatingShellHasFallback,
  isolatedFloatingShellKind,
  type IsolatedFloatingShellKind,
} from "./isolatedFloatingShell";

const KINDS: readonly IsolatedFloatingShellKind[] = [
  "local-disabled",
  "sign-in",
  "chat",
  "not-found",
  "error",
  "connecting",
];

describe("isolated floating shell", () => {
  it("keeps the readiness frame mounted for notices and a rejected route", () => {
    expect(
      isolatedFloatingShellKind({ localEnvironmentDisabled: true, authenticated: false }),
    ).toBe("local-disabled");
    expect(
      isolatedFloatingShellKind({ localEnvironmentDisabled: false, authenticated: false }),
    ).toBe("sign-in");
    expect(
      isolatedFloatingShellKind({ localEnvironmentDisabled: false, authenticated: true }),
    ).toBe("chat");
    expect(
      isolatedFloatingShellKind({
        localEnvironmentDisabled: true,
        authenticated: false,
        notFound: true,
      }),
    ).toBe("not-found");
    expect(
      isolatedFloatingShellKind({
        localEnvironmentDisabled: false,
        authenticated: false,
        error: true,
        connecting: true,
        notFound: true,
      }),
    ).toBe("error");
    expect(
      isolatedFloatingShellKind({
        localEnvironmentDisabled: true,
        authenticated: false,
        connecting: true,
      }),
    ).toBe("connecting");

    for (const kind of KINDS) {
      const plan = detachedChatShellPlan(isolatedFloatingShellHasFallback(kind));
      expect(plan.frame, kind).toBe(true);
      expect(plan.guardWrapsRoutedChildren, kind).toBe(kind === "chat");
    }
  });

  it("marks the panel ready when the frame activates", async () => {
    const ready = vi.fn(async () => undefined);
    let shown = 0;
    const stop = activateDetachedChatFrame(
      {
        onShow: () => {
          shown += 1;
          return () => {
            shown -= 1;
          };
        },
        setPanelReady: ready,
      },
      () => undefined,
    );

    expect(shown).toBe(1);
    expect(ready).toHaveBeenCalledOnce();
    stop();
    expect(shown).toBe(0);
    expect(activateDetachedChatFrame(undefined, () => undefined)).not.toThrow();
  });
});
