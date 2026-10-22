import { describe, expect, it } from "@effect/vitest";

import { toolActivityBrandMark } from "./brandMarks.ts";

describe("toolActivityBrandMark", () => {
  it("recognizes brand logos and favicon-service URLs for their domains", () => {
    expect(
      toolActivityBrandMark({
        _tag: "themed-logo",
        logoUrl: "https://www.google.com/s2/favicons?domain=linear.app&sz=64",
      }),
    ).toBe("linear");
    expect(
      toolActivityBrandMark({ _tag: "website", pageUrl: "https://linear.app/acme/issue/ENG-1" }),
    ).toBe("linear");
    expect(
      toolActivityBrandMark({ _tag: "website", pageUrl: "https://notes.granola.ai/d/abc" }),
    ).toBe("granola");
    expect(
      toolActivityBrandMark({
        _tag: "themed-logo",
        logoUrl:
          "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://calendar.google.com&size=64",
      }),
    ).toBe("googleCalendar");
  });

  it("prefers the most specific domain", () => {
    expect(
      toolActivityBrandMark({ _tag: "website", pageUrl: "https://mail.google.com/mail/u/0" }),
    ).toBe("gmail");
    expect(
      toolActivityBrandMark({ _tag: "website", pageUrl: "https://www.google.com/search?q=x" }),
    ).toBe("google");
  });

  it("recognizes native apps by bundle ID or display name", () => {
    expect(
      toolActivityBrandMark({
        _tag: "native-app",
        app: { _tag: "app-id", appId: "com.google.Chrome" },
      }),
    ).toBe("chrome");
    expect(
      toolActivityBrandMark({
        _tag: "native-app",
        app: { _tag: "display-name", displayName: "Safari" },
      }),
    ).toBe("safari");
    expect(
      toolActivityBrandMark({
        _tag: "native-app",
        app: { _tag: "app-id", appId: "com.apple.finder" },
      }),
    ).toBe("finder");
    expect(
      toolActivityBrandMark({
        _tag: "native-app",
        app: { _tag: "display-name", displayName: "Microsoft Edge" },
      }),
    ).toBe("edge");
  });

  it("marks local development pages", () => {
    expect(
      toolActivityBrandMark({ _tag: "website", pageUrl: "http://localhost:5875/thread" }),
    ).toBe("localhost");
    expect(toolActivityBrandMark({ _tag: "website", pageUrl: "http://[::1]:3000/" })).toBe(
      "localhost",
    );
    expect(toolActivityBrandMark({ _tag: "website", pageUrl: "http://app.localhost/" })).toBe(
      "localhost",
    );
  });

  it("leaves other icons alone", () => {
    expect(
      toolActivityBrandMark({
        _tag: "themed-logo",
        logoUrl: "https://www.google.com/s2/favicons?domain=firecrawl.dev&sz=64",
      }),
    ).toBeNull();
    expect(
      toolActivityBrandMark({ _tag: "website", pageUrl: "https://notlinear.app/" }),
    ).toBeNull();
    expect(
      toolActivityBrandMark({
        _tag: "native-app",
        app: { _tag: "app-id", appId: "com.example.unknown" },
      }),
    ).toBeNull();
  });
});
