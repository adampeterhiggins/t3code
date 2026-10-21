import { describe, expect, it } from "vite-plus/test";

import {
  QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT,
  QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT,
  consumesLegacyLocalStorage,
  parseDesktopWindowRole,
  parseQuickMessageSessionIsolated,
} from "./windowRole.ts";

const rendererArgv = (...markers: readonly string[]) =>
  ["/app/electron", "--type=renderer", ...markers, "https://desktop.t3.localhost/"] as const;

describe("parseDesktopWindowRole", () => {
  it("defaults to main when the quick-message marker is absent", () => {
    const role = parseDesktopWindowRole(rendererArgv());
    expect(role).toBe("main");
    expect(consumesLegacyLocalStorage(role)).toBe(true);
  });

  it("reads quick-message only from the exact construction marker", () => {
    const role = parseDesktopWindowRole(rendererArgv(QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT));
    expect(role).toBe("quick-message");
    expect(consumesLegacyLocalStorage(role)).toBe(false);
    expect(parseDesktopWindowRole(rendererArgv("--t3code-window-role=quick-message-panel"))).toBe(
      "main",
    );
    expect(parseDesktopWindowRole(rendererArgv("--t3code-window-role=main"))).toBe("main");
  });

  it("defaults to main when argv is missing", () => {
    expect(parseDesktopWindowRole(undefined)).toBe("main");
    expect(parseQuickMessageSessionIsolated(undefined)).toBe(false);
  });
});

describe("parseQuickMessageSessionIsolated", () => {
  it("is false for the main window, including a stray isolation marker", () => {
    expect(parseQuickMessageSessionIsolated(rendererArgv())).toBe(false);
    expect(
      parseQuickMessageSessionIsolated(rendererArgv(QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT)),
    ).toBe(false);
    expect(
      parseQuickMessageSessionIsolated(
        rendererArgv("--t3code-window-role=main", QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT),
      ),
    ).toBe(false);
  });

  it("is false for a legacy quick-message window without the isolation marker", () => {
    expect(parseQuickMessageSessionIsolated(rendererArgv(QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT))).toBe(
      false,
    );
    expect(
      parseQuickMessageSessionIsolated(
        rendererArgv(QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT, "--t3code-quick-message-isolated-panel"),
      ),
    ).toBe(false);
  });

  it("is true only when the quick-message role and the exact marker are both present", () => {
    expect(
      parseQuickMessageSessionIsolated(
        rendererArgv(QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT, QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT),
      ),
    ).toBe(true);
    expect(
      parseQuickMessageSessionIsolated(
        rendererArgv(QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT, QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT),
      ),
    ).toBe(true);
    expect(
      parseQuickMessageSessionIsolated(
        rendererArgv(
          "--t3code-window-role=quick-message-panel",
          QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT,
        ),
      ),
    ).toBe(false);
  });
});
