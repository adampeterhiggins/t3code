import { describe, expect, it } from "vite-plus/test";

import {
  QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT,
  consumesLegacyLocalStorage,
  parseDesktopWindowRole,
} from "./windowRole.ts";

const rendererArgv = (roleArgument?: string) =>
  [
    "/app/electron",
    "--type=renderer",
    ...(roleArgument === undefined ? [] : [roleArgument]),
    "https://desktop.t3.localhost/",
  ] as const;

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
  });
});
