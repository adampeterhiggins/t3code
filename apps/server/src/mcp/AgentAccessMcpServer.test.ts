import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import { toolkitRegistration } from "./McpHttpServer.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../orchestration-v2/ThreadSearch.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import { UsageService } from "../usage/UsageService.ts";
import * as AgentAccessMcpServer from "./AgentAccessMcpServer.ts";

const environmentId = EnvironmentId.make("environment-agent-access-test");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const session = (
  scopes: ReadonlyArray<"orchestration:read" | "orchestration:operate" | "access:read">,
) => ({
  sessionId: AuthSessionId.make("session-agent-access-test"),
  subject: "agent-access-token",
  method: "bearer-access-token" as const,
  scopes,
  label: "EOD brief",
});

// Mirrors the real preference for a session cookie over the Authorization header.
const FakeEnvironmentAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
  authenticateHttpRequest: (request) => {
    if (request.headers.cookie !== undefined)
      return Effect.succeed(session(["orchestration:read", "orchestration:operate"]));
    switch (request.headers.authorization) {
      case "Bearer read-token":
        return Effect.succeed(session(["orchestration:read"]));
      case "Bearer operate-token":
        return Effect.succeed(session(["orchestration:read", "orchestration:operate"]));
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
const ThreadOnlyToolkit = Toolkit.make(ThreadTool);
const ThreadMcpLive = toolkitRegistration(
  ThreadOnlyToolkit,
  McpToolAccess.toLayer(ThreadOnlyToolkit, {
    thread_only_tool: McpToolAccess.reads(() => Effect.succeed({})),
  }),
).pipe(
  Layer.provideMerge(
    McpServer.layerHttp({
      name: "thread",
      version: "1.0.0",
      path: "/mcp",
      protocols: [McpProtocol.v2025_06_18],
    }),
  ),
);

const RoutesLive = Layer.mergeAll(AgentAccessMcpServer.layer, ThreadMcpLive).pipe(
  Layer.provide(
    Layer.mergeAll(
      FakeEnvironmentAuth,
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(environmentId),
      }),
      Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({}),
      Layer.mock(UsageService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadSearch.ThreadSearch)({}),
      Layer.mock(ProviderRegistry.ProviderRegistry)({}),
      Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/projects" }),
      Layer.mock(SourceControlRepositoryService.SourceControlRepositoryService)({}),
      Layer.mock(ServerSettings.ServerSettingsService)({}),
      Layer.succeed(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => new Uint8Array(size),
          digest: (_algorithm, data) => Effect.succeed(data),
        }),
      ),
      Layer.fresh(SqlitePersistence.layerMemory),
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-agent-access-mcp-" }),
    ).pipe(Layer.provideMerge(NodeServices.layer)),
  ),
);

const INITIALIZE = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agent-access-test","version":"1.0.0"}}}`;

const post = (path: string, body: string, headers: Record<string, string>) =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.post(path, {
      headers: { accept: "application/json, text/event-stream", ...headers },
      body: HttpBody.text(body, "application/json"),
    }),
  );

/** Opens an MCP session and returns a function that sends JSON-RPC requests on it. */
const openSession = (path: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const initialized = yield* post(path, INITIALIZE, headers);
    expect(initialized.status).toBe(200);
    const sessionHeaders = {
      ...headers,
      "mcp-session-id": initialized.headers["mcp-session-id"]!,
      "mcp-protocol-version": "2025-06-18",
    };
    yield* post(path, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, sessionHeaders);
    let id = 1;
    return (method: string, params: unknown) =>
      Effect.gen(function* () {
        id += 1;
        const response = yield* post(
          path,
          encodeJson({ jsonrpc: "2.0", id, method, params }),
          sessionHeaders,
        );
        return (yield* response.json) as { result: Record<string, unknown> };
      });
  });

const listTools = (path: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const request = yield* openSession(path, headers);
    const body = yield* request("tools/list", {});
    return (body.result.tools as Array<{ name: string }>).map((tool) => tool.name);
  });

it("gives an agent access token a client caller labelled with the token", () => {
  const scope = AgentAccessMcpServer.agentAccessInvocationScope({
    environmentId,
    session: { sessionId: AuthSessionId.make("session-1"), label: "EOD brief" },
    issuedAt: 5,
  });
  expect(scope.thread).toBeUndefined();
  expect(scope.client).toEqual({
    sessionId: "session-1",
    label: "EOD brief",
    access: "full-access",
  });
  expect([...scope.capabilities]).toEqual(["orchestration"]);
  expect(scope.requestNamespace).toBe("agent-access:session-1");
  const unlabelled = AgentAccessMcpServer.agentAccessInvocationScope({
    environmentId,
    session: { sessionId: AuthSessionId.make("session-2") },
    issuedAt: 5,
  });
  expect(unlabelled.client?.label).toBe("Agent access token");
});

it.effect("authenticates /mcp/query and /mcp/operate by the token's scopes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* HttpRouter.serve(RoutesLive, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );

      const anonymous = yield* post("/mcp/query", INITIALIZE, {});
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers["www-authenticate"]).toBe("Bearer");

      // A browser's session cookie must not unlock these tools for another page.
      const cookieOnly = yield* post("/mcp/operate", INITIALIZE, { cookie: "t3_session=browser" });
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
      expect(queryTools).not.toContain("t3_thread_launch");
      expect(queryTools).not.toContain("thread_only_tool");

      expect(yield* listTools("/mcp", {})).toEqual(["thread_only_tool"]);

      const readOnOperate = yield* post("/mcp/operate", INITIALIZE, {
        authorization: "Bearer read-token",
      });
      expect(readOnOperate.status).toBe(403);
      const operateTools = yield* listTools("/mcp/operate", {
        authorization: "Bearer operate-token",
      });
      for (const name of [
        "get_activity_timeline",
        "t3_thread_launch",
        "t3_thread_send",
        "t3_thread_wait",
        "t3_thread_interrupt",
        "t3_thread_organize",
        "t3_pending_request_respond",
        "t3_project_create",
        "t3_environment_read",
        "t3_approval_respond",
      ]) {
        expect(operateTools).toContain(name);
      }
      // Preview and device tools act as a calling thread, which a token does not have.
      expect(operateTools).not.toContain("preview_snapshot");
      expect(operateTools).not.toContain("thread_only_tool");
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("runs /mcp/operate tools as a client caller without a thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* HttpRouter.serve(RoutesLive, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const request = yield* openSession("/mcp/operate", { authorization: "Bearer operate-token" });
      const called = yield* request("tools/call", {
        name: "t3_thread_launch",
        arguments: { title: "From outside" },
      });
      // Without a calling thread the launch needs a project; a thread caller would inherit its own.
      expect(called.result.isError).toBe(true);
      const [content] = called.result.content as ReadonlyArray<{ readonly text: string }>;
      expect(decodeJson(content?.text)).toMatchObject({ code: "target_required" });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
