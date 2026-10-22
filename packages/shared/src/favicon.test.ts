import { describe, expect, it } from "@effect/vitest";

import { faviconUrlForOrigin } from "./favicon.ts";

describe("faviconUrlForOrigin", () => {
  it("sends only the public hostname and requested size, never the port", () => {
    expect(faviconUrlForOrigin("https://github.com:8443/pingdotgg/t3code?private=query", 64)).toBe(
      "https://www.google.com/s2/favicons?domain=github.com&sz=64",
    );
  });

  // regression: #5838 no favicon request for missing or non-http origins
  it.each([null, "invalid URL", "file:///tmp/private"])(
    "rejects an invalid or unsupported origin %s",
    (origin) => {
      expect(faviconUrlForOrigin(origin)).toBeNull();
    },
  );
});
