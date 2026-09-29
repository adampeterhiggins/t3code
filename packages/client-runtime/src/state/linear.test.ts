import { describe, expect, it } from "vite-plus/test";

import { linearAppUrl } from "./linear.ts";

describe("linearAppUrl", () => {
  it("moves a linear.app link onto the Linear app's scheme", () => {
    expect(linearAppUrl("https://linear.app/acme/issue/ENG-1/fix-login")).toBe(
      "linear://acme/issue/ENG-1/fix-login",
    );
    expect(linearAppUrl("https://linear.app/acme/issue/ENG-1#comment-2")).toBe(
      "linear://acme/issue/ENG-1#comment-2",
    );
  });

  it("leaves other links alone", () => {
    for (const url of ["https://example.com/acme/issue/ENG-1", "http://linear.app/a", "nope"]) {
      expect(linearAppUrl(url), url).toBeNull();
    }
  });
});
