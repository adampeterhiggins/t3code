import { NodeHttpServer } from "@effect/platform-node";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { UsageService } from "../../usage/UsageService.ts";
import * as QueryMcpServer from "./QueryMcpServer.ts";

const session = (scopes: ReadonlyArray<"orchestration:read" | "access:read">) => ({
  sessionId: AuthSessionId.make("session-query-test"),
  subject: "agent-access-token",
  method: "bearer-access-token" as const,
  scopes,
});

// Mirrors the real preference for a session cookie over the Authorization header.
const FakeEnvironmentAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
  authenticateHttpRequest: (request) => {
    if (request.headers.cookie !== undefined)
      return Effect.succeed(session(["orchestration:read"]));
    switch (request.headers.authorization) {
      case "Bearer read-token":
        return Effect.succeed(session(["orchestration:read"]));
      case "Bearer access-only-token":
        return Effect.succeed(session(["access:read"]));
      default:
        return Effect.fail(new EnvironmentAuth.ServerAuthInvalidCredentialError({}));
    }
  },
});

// Stands in for the thread-scoped `/mcp` server that shares the router.
const ThreadTool = Tool.make("thread_only_tool", {
  parameters: Schema.Struct({ value: Schema.optional(Schema.String) }),
  success: Schema.Struct({}),
});
const ThreadToolkit = Toolkit.make(ThreadTool);
const ThreadMcpLive = McpServer.toolkit(ThreadToolkit).pipe(
  Layer.provide(ThreadToolkit.toLayer({ thread_only_tool: () => Effect.succeed({}) })),
  Layer.provideMerge(
    McpServer.layerHttp({
      name: "thread",
      version: "1.0.0",
      path: "/mcp",
      protocols: [McpProtocol.v2025_06_18],
    }),
  ),
);

const RoutesLive = Layer.mergeAll(QueryMcpServer.layer, ThreadMcpLive).pipe(
  Layer.provide(
    Layer.mergeAll(
      FakeEnvironmentAuth,
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getDescriptor: Effect.succeed({
          environmentId: EnvironmentId.make("environment-query-http-test"),
          label: "Test machine",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        }),
      }),
      Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({}),
      Layer.mock(ProviderService)({}),
      Layer.mock(UsageService)({}),
      Layer.fresh(SqlitePersistenceMemory),
    ),
  ),
);

const INITIALIZE = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"query-test","version":"1.0.0"}}}`;

const post = (path: string, body: string, headers: Record<string, string>) =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.post(path, {
      headers: { accept: "application/json, text/event-stream", ...headers },
      body: HttpBody.text(body, "application/json"),
    }),
  );

/** Opens an MCP session and returns the tool names it lists. */
const listTools = (path: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const initialized = yield* post(path, INITIALIZE, headers);
    expect(initialized.status).toBe(200);
    const sessionHeaders = {
      ...headers,
      "mcp-session-id": initialized.headers["mcp-session-id"]!,
      "mcp-protocol-version": "2025-06-18",
    };
    yield* post(path, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, sessionHeaders);
    const listed = yield* post(
      path,
      `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
      sessionHeaders,
    );
    const body = (yield* listed.json) as { result: { tools: Array<{ name: string }> } };
    return body.result.tools.map((tool) => tool.name);
  });

it.effect("authenticates /mcp/query with a read-scoped Authorization header only", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* HttpRouter.serve(RoutesLive, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );

      const anonymous = yield* post("/mcp/query", INITIALIZE, {});
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers["www-authenticate"]).toBe("Bearer");

      // A browser's session cookie must not unlock history for another page.
      const cookieOnly = yield* post("/mcp/query", INITIALIZE, { cookie: "t3_session=browser" });
      expect(cookieOnly.status).toBe(401);
      const cookieWithBadToken = yield* post("/mcp/query", INITIALIZE, {
        cookie: "t3_session=browser",
        authorization: "Bearer not-a-token",
      });
      expect(cookieWithBadToken.status).toBe(401);

      const withoutReadScope = yield* post("/mcp/query", INITIALIZE, {
        authorization: "Bearer access-only-token",
      });
      expect(withoutReadScope.status).toBe(403);

      const queryTools = yield* listTools("/mcp/query", { authorization: "Bearer read-token" });
      expect(queryTools).toContain("list_threads");
      expect(queryTools).toContain("get_activity_timeline");
      expect(queryTools).not.toContain("thread_only_tool");

      const threadTools = yield* listTools("/mcp", {});
      expect(threadTools).toEqual(["thread_only_tool"]);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
