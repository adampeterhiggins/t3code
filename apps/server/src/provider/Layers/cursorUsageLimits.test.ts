import { describe, expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { cursorUsageResponseToLimits, readCursorUsageLimits } from "./cursorUsageLimits.ts";

const withNodeServices = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  effect.pipe(Effect.provide(NodeServices.layer));

describe("Cursor usage limits", () => {
  const checkedAt = "2026-09-16T00:00:00.000Z";

  it("uses the advertised percentages and billing-cycle reset", () => {
    const limits = cursorUsageResponseToLimits(
      {
        billingCycleEnd: "1789876386000",
        planUsage: { totalPercentUsed: 72.4, autoPercentUsed: 69.5, apiPercentUsed: 100 },
      },
      checkedAt,
    );
    expect(limits.windows).toEqual(
      expect.arrayContaining([
        {
          id: "totalPercentUsed",
          kind: "monthly",
          label: "Overall",
          usedPercent: 72.4,
          resetsAt: "2026-09-20T03:53:06.000Z",
        },
        {
          id: "autoPercentUsed",
          kind: "monthly",
          label: "Cursor Models",
          usedPercent: 69.5,
          resetsAt: "2026-09-20T03:53:06.000Z",
        },
        {
          id: "apiPercentUsed",
          kind: "monthly",
          label: "Other Models",
          usedPercent: 100,
          resetsAt: "2026-09-20T03:53:06.000Z",
        },
      ]),
    );
  });

  it("does not invent unused allowance for absent buckets", () => {
    expect(cursorUsageResponseToLimits({ planUsage: {} }, checkedAt).unavailable?.reason).toBe(
      "unsupported",
    );
    expect(
      cursorUsageResponseToLimits({ planUsage: { totalPercentUsed: 0 } }, checkedAt).windows,
    ).toEqual([{ id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 0 }]);
    expect(
      cursorUsageResponseToLimits({ planUsage: { totalPercentUsed: 150 } }, checkedAt).windows,
    ).toEqual([{ id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 100 }]);
  });

  it.effect("reads the instance's credentials and endpoint even when usage enabled is false", () =>
    Effect.gen(function* () {
      yield* withNodeServices(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped();
          yield* fs.makeDirectory(path.join(directory, "cursor"));
          yield* fs.writeFileString(
            path.join(directory, "cursor", "auth.json"),
            '{"accessToken":"instance-token"}',
          );
          const client = HttpClient.make((request) => {
            expect(request.url).toBe(
              "https://cursor.example/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
            );
            expect(request.method).toBe("POST");
            expect(request.headers.authorization).toBe("Bearer instance-token");
            expect(request.headers["connect-protocol-version"]).toBe("1");
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ enabled: false, planUsage: { totalPercentUsed: 42 } }),
              ),
            );
          });
          yield* fs.makeDirectory(path.join(directory, ".cursor"));
          yield* fs.writeFileString(
            path.join(directory, ".cursor", "auth.json"),
            '{"accessToken":"instance-token"}',
          );
          for (const platform of ["linux", "darwin"] as const) {
            const limits = yield* readCursorUsageLimits(
              { apiEndpoint: "https://cursor.example/" },
              { XDG_CONFIG_HOME: directory, HOME: directory, AGENT_CLI_CREDENTIAL_STORE: "file" },
            ).pipe(
              Effect.provideService(HostProcessPlatform, platform),
              Effect.provideService(HttpClient.HttpClient, client),
            );
            expect(limits.windows[0]?.usedPercent).toBe(42);
          }
        }).pipe(Effect.scoped),
      );
    }),
  );

  it.effect(
    "never reads stale files for keychain or memory logins, but accepts an explicit auth token",
    () =>
      Effect.gen(function* () {
        for (const platform of ["linux", "darwin"] as const) {
          for (const token of [undefined, "explicit-token"]) {
            const limits = yield* withNodeServices(
              readCursorUsageLimits(
                { apiEndpoint: "" },
                {
                  AGENT_CLI_CREDENTIAL_STORE: platform === "linux" ? "memory" : "default",
                  ...(token ? { CURSOR_AUTH_TOKEN: token } : {}),
                },
                {
                  allowKeychain: false,
                  keychainToken: async () => {
                    throw new Error("must not read Keychain before opt-in");
                  },
                },
              ).pipe(
                Effect.provideService(HostProcessPlatform, platform),
                Effect.provideService(
                  FileSystem.FileSystem,
                  FileSystem.makeNoop({
                    readFileString: () => Effect.die("must not read an unrelated credential file"),
                  }),
                ),
                Effect.provideService(
                  HttpClient.HttpClient,
                  HttpClient.make((request) => {
                    expect(token).toBe("explicit-token");
                    expect(request.headers.authorization).toBe("Bearer explicit-token");
                    return Effect.succeed(
                      HttpClientResponse.fromWeb(
                        request,
                        Response.json({ planUsage: { totalPercentUsed: 10 } }),
                      ),
                    );
                  }),
                ),
              ),
            );
            if (token) expect(limits.windows[0]?.usedPercent).toBe(10);
            else expect(limits.unavailable?.reason).toBe("unsupported");
          }
        }
      }),
  );

  it.effect("reports failed requests without exposing credentials or response bodies", () =>
    Effect.gen(function* () {
      const limits = yield* withNodeServices(
        readCursorUsageLimits({ apiEndpoint: "" }, { CURSOR_AUTH_TOKEN: "private-token" }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("private response", { status: 401 }),
                ),
              ),
            ),
          ),
        ),
      );
      expect(limits.unavailable).toEqual({
        reason: "probeFailed",
        message: "Cursor could not read usage limits.",
      });
    }),
  );

  it.effect("does not use a stored login for an explicit API key", () =>
    Effect.gen(function* () {
      const limits = yield* withNodeServices(
        readCursorUsageLimits({ apiEndpoint: "" }, { CURSOR_API_KEY: "different-account" }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("must not request usage")),
          ),
        ),
      );
      expect(limits.unavailable?.reason).toBe("unsupported");
    }),
  );

  it.effect("reads the default macOS Cursor login from Keychain for limits", () =>
    Effect.gen(function* () {
      const limits = yield* withNodeServices(
        readCursorUsageLimits(
          { apiEndpoint: "" },
          {},
          { allowKeychain: true, keychainToken: async () => "keychain-token" },
        ).pipe(
          Effect.provideService(HostProcessPlatform, "darwin"),
          Effect.provideService(
            FileSystem.FileSystem,
            FileSystem.makeNoop({
              readFileString: () => Effect.die("must not read a stale credential file"),
            }),
          ),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              expect(request.headers.authorization).toBe("Bearer keychain-token");
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json({ planUsage: { totalPercentUsed: 42 } }),
                ),
              );
            }),
          ),
        ),
      );
      expect(limits.windows[0]?.usedPercent).toBe(42);
    }),
  );

  it.effect("reports a Keychain initialization failure without failing the provider refresh", () =>
    Effect.gen(function* () {
      const limits = yield* withNodeServices(
        readCursorUsageLimits(
          { apiEndpoint: "" },
          {},
          {
            allowKeychain: true,
            keychainToken: async () => {
              throw new Error("Keychain initialization failed");
            },
          },
        ).pipe(
          Effect.provideService(HostProcessPlatform, "darwin"),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("must not request limits without a login")),
          ),
        ),
      );
      expect(limits.unavailable?.reason).toBe("probeFailed");
    }),
  );

  it.effect("does not read Keychain or send its token to a custom endpoint", () =>
    Effect.gen(function* () {
      for (const [apiEndpoint, environment] of [
        ["http://localhost:3000", {}],
        ["", { CURSOR_API_ENDPOINT: "http://localhost:3000" }],
        ["https://cursor-proxy.example", {}],
        ["", { CURSOR_API_ENDPOINT: "https://cursor-proxy.example" }],
      ] as const) {
        const limits = yield* withNodeServices(
          readCursorUsageLimits({ apiEndpoint }, environment, {
            allowKeychain: true,
            keychainToken: async () => {
              throw new Error("must not read Keychain for a custom endpoint");
            },
          }).pipe(
            Effect.provideService(HostProcessPlatform, "darwin"),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("must not send a Keychain credential to a proxy")),
            ),
          ),
        );
        expect(limits.unavailable?.reason).toBe("unsupported");
        expect(limits.unavailable?.message).toContain("default Cursor endpoint");
      }
    }),
  );
  it.effect("reads each instance's limits with its own SDK key, never a shared login", () =>
    Effect.gen(function* () {
      const requests: Array<{ url: string; authorization: string | undefined }> = [];
      const client = HttpClient.make((request) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        if (request.url.endsWith("/auth/exchange_user_api_key")) {
          const key = request.headers.authorization?.replace("Bearer ", "");
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json({ accessToken: `token-for-${key}` })),
          );
        }
        const percent = request.headers.authorization === "Bearer token-for-key-a" ? 12 : 88;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ planUsage: { totalPercentUsed: percent } }),
          ),
        );
      });
      const read = (credential: { apiKey: string; backendUrl?: string }) =>
        withNodeServices(
          readCursorUsageLimits(
            { apiEndpoint: "" },
            // A host token and API key must not stand in for the instance's own sign-in.
            { CURSOR_AUTH_TOKEN: "host-token", CURSOR_API_KEY: "host-key" },
            {
              allowKeychain: true,
              keychainToken: async () => {
                throw new Error("must not read the shared Keychain login");
              },
              sdkCredential: credential,
              sharedLogin: false,
            },
          ).pipe(
            Effect.provideService(HostProcessPlatform, "darwin"),
            Effect.provideService(HttpClient.HttpClient, client),
          ),
        );

      const first = yield* read({ apiKey: "key-a", backendUrl: "https://api2.cursor.sh/" });
      const second = yield* read({ apiKey: "key-b" });
      expect(first.windows[0]?.usedPercent).toBe(12);
      expect(second.windows[0]?.usedPercent).toBe(88);
      expect(requests).toEqual([
        {
          url: "https://api2.cursor.sh/auth/exchange_user_api_key",
          authorization: "Bearer key-a",
        },
        {
          url: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
          authorization: "Bearer token-for-key-a",
        },
        {
          url: "https://api2.cursor.sh/auth/exchange_user_api_key",
          authorization: "Bearer key-b",
        },
        {
          url: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
          authorization: "Bearer token-for-key-b",
        },
      ]);
    }),
  );

  it.effect("reports a rejected SDK key as a failed read, not another account's usage", () =>
    Effect.gen(function* () {
      const limits = yield* withNodeServices(
        readCursorUsageLimits(
          { apiEndpoint: "" },
          {},
          {
            allowKeychain: true,
            keychainToken: async () => "shared-keychain-token",
            sdkCredential: { apiKey: "revoked" },
            sharedLogin: true,
          },
        ).pipe(
          Effect.provideService(HostProcessPlatform, "darwin"),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              expect(request.url).toBe("https://api2.cursor.sh/auth/exchange_user_api_key");
              return Effect.succeed(
                HttpClientResponse.fromWeb(request, new Response("{}", { status: 401 })),
              );
            }),
          ),
        ),
      );
      expect(limits.unavailable?.reason).toBe("probeFailed");
    }),
  );

  it.effect("gives an added instance without a sign-in no shared login", () =>
    Effect.gen(function* () {
      const limits = yield* withNodeServices(
        readCursorUsageLimits(
          { apiEndpoint: "" },
          {},
          {
            allowKeychain: true,
            keychainToken: async () => {
              throw new Error("must not read the shared Keychain login");
            },
            sharedLogin: false,
          },
        ).pipe(
          Effect.provideService(HostProcessPlatform, "darwin"),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("must not request usage")),
          ),
        ),
      );
      expect(limits.unavailable?.reason).toBe("unsupported");
    }),
  );
});
