import { describe, expect, it } from "vite-plus/test";

import { parseDevinReviewUrl } from "./devinReview.ts";

describe("parseDevinReviewUrl", () => {
  it.each([
    ["https://app.devin.ai/review/acme/api/pull/42", { repository: "acme/api", number: 42 }],
    ["https://app.devin.ai/review/acme/api/pull/42/", { repository: "acme/api", number: 42 }],
    ["https://app.devin.ai/review/acme/api/pull/0", null],
    ["https://app.devin.ai/sessions/abc", null],
    ["http://app.devin.ai/review/acme/api/pull/42", null],
    ["https://evil.example/review/acme/api/pull/42", null],
    ["https://github.com/acme/api/pull/42", null],
    ["not a url", null],
  ])("reads %s", (url, expected) => {
    expect(parseDevinReviewUrl(url)).toEqual(expected);
  });

  it("accepts GitHub pull request links only when asked", () => {
    expect(
      parseDevinReviewUrl("https://github.com/acme/api/pull/42/files", { acceptGitHub: true }),
    ).toEqual({ repository: "acme/api", number: 42 });
    expect(
      parseDevinReviewUrl("https://github.com/acme/api/issues/42", { acceptGitHub: true }),
    ).toBeNull();
  });
});
