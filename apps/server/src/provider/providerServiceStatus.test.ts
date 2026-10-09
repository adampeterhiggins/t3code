import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  readProviderServiceReports,
  serviceStatusFromBody,
  withProviderServiceStatus,
} from "./providerServiceStatus.ts";

const checkedAt = "2026-10-09T06:00:00.000Z";

function provider(driver: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("provider service status", () => {
  it("reads a partially degraded Statuspage rollup", () => {
    expect(
      serviceStatusFromBody("https://status.claude.com", checkedAt, {
        status: { indicator: "minor", description: " Partially Degraded Service " },
      }),
    ).toEqual({
      indicator: "minor",
      description: "Partially Degraded Service",
      pageUrl: "https://status.claude.com",
      checkedAt,
    });
    expect(serviceStatusFromBody("https://status.openai.com", checkedAt, { status: {} })).toBe(
      undefined,
    );
  });

  it("stamps a rollup onto matching providers and clears it when the page recovers", () => {
    const claude = provider("claudeAgent");
    const degraded = withProviderServiceStatus(
      [claude],
      [
        {
          driver: claude.driver,
          status: {
            indicator: "minor",
            description: "Partially Degraded Service",
            pageUrl: "https://status.claude.com",
            checkedAt,
          },
        },
      ],
    );
    expect(degraded[0]?.serviceStatus?.description).toBe("Partially Degraded Service");
    expect(withProviderServiceStatus(degraded, [])[0]?.serviceStatus).toBeUndefined();
  });

  it.effect("keeps the last good rollup when a later status read fails", () =>
    Effect.gen(function* () {
      const previous = [
        {
          driver: ProviderDriverKind.make("claudeAgent"),
          status: {
            indicator: "minor" as const,
            description: "Partially Degraded Service",
            pageUrl: "https://status.claude.com",
            checkedAt,
          },
        },
      ];
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          const url = request.url;
          if (url.includes("status.claude.com")) {
            return HttpClientResponse.fromWeb(request, Response.json(null, { status: 503 }));
          }
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              status: { indicator: "none", description: "All Systems Operational" },
            }),
          );
        }),
      );
      const reports = yield* readProviderServiceReports(previous).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      expect(reports.find((report) => report.driver === "claudeAgent")?.status.description).toBe(
        "Partially Degraded Service",
      );
      expect(reports.find((report) => report.driver === "codex")?.status.indicator).toBe("none");
      expect(reports.find((report) => report.driver === "cursor")?.status.pageUrl).toBe(
        "https://status.cursor.com",
      );
      expect(reports.find((report) => report.driver === "devin")?.status.pageUrl).toBe(
        "https://www.devinstatus.com",
      );
      expect(reports.find((report) => report.driver === "grok")?.status.pageUrl).toBe(
        "https://status.x.ai",
      );
    }),
  );
});
