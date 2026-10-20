import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { webToolLabel, webToolView, webUrlBreadcrumb } from "./webTool.ts";

type WebSearchItem = Extract<OrchestrationV2TurnItem, { type: "web_search" }>;

const item = (fields: Partial<WebSearchItem>) =>
  ({ type: "web_search", ...fields }) as WebSearchItem;

describe("webToolView", () => {
  it("unwraps a fetch stored as Claude's raw WebFetch JSON", () => {
    const url = "https://docs.github.com/en/code-security/private-registries";
    const view = webToolView(
      item({
        patterns: [url],
        results: [
          {
            url,
            snippet: JSON.stringify({
              bytes: 47943,
              code: 200,
              codeText: "OK",
              result: "**Artifact Registry** needs a url.",
              durationMs: 10597,
              url,
            }),
          },
        ],
      }),
    );
    expect(view).toEqual({
      action: "fetch",
      query: undefined,
      url,
      prompt: undefined,
      answer: "**Artifact Registry** needs a url.",
      statusCode: 200,
      results: [],
    });
    expect(webToolLabel(view)).toBe("Fetched docs.github.com › … › private-registries");
  });

  it("reads a legacy page snippet as the fetch's answer", () => {
    const view = webToolView(
      item({
        patterns: ["https://t3.codes"],
        results: [{ url: "https://t3.codes", snippet: "T3 Code page" }],
      }),
    );
    expect(view).toMatchObject({ action: "fetch", answer: "T3 Code page", results: [] });
  });

  it("keeps a search's hits and joins its queries", () => {
    const results = [{ title: "Dependabot OIDC", url: "https://github.blog/oidc" }];
    const view = webToolView(item({ patterns: ["dependabot oidc", "gcp", "gcp"], results }));
    expect(view).toMatchObject({ action: "search", query: "dependabot oidc, gcp", results });
    expect(webToolLabel(view)).toBe("Searched “dependabot oidc, gcp”");
  });

  it("trusts the item's own fields over inference", () => {
    const view = webToolView(
      item({
        action: "fetch",
        url: "https://example.com/a",
        prompt: "Summarise",
        answer: '{"not": "legacy"}',
        statusCode: 404,
      }),
    );
    expect(view).toMatchObject({
      action: "fetch",
      url: "https://example.com/a",
      prompt: "Summarise",
      answer: '{"not": "legacy"}',
      statusCode: 404,
    });
  });
});

describe("webUrlBreadcrumb", () => {
  it("shortens deep paths and drops www", () => {
    expect(webUrlBreadcrumb("https://www.example.com/")).toBe("example.com");
    expect(webUrlBreadcrumb("https://example.com/docs")).toBe("example.com › docs");
    expect(webUrlBreadcrumb("https://example.com/a/b%20c?q=1")).toBe("example.com › … › b c");
    expect(webUrlBreadcrumb("not a url")).toBe("not a url");
  });
});
