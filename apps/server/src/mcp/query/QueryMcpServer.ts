import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Types from "effect/Types";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import packageJson from "../../../package.json" with { type: "json" };
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { normalizeMcpHttpResponse } from "../McpHttpServer.ts";
import { QueryToolkitHandlersLive } from "./handlers.ts";
import { QueryToolkit } from "./tools.ts";

/**
 * `/mcp/query` serves read-only history to agents outside T3 Code, such as a
 * scheduled Claude Code run. It is a separate MCP server from `/mcp` on
 * purpose: `/mcp` is how an agent inside one thread acts, scoped to that
 * thread by a per-session token, and must never see other threads. This
 * endpoint instead takes an environment access token with
 * `orchestration:read`, the same credential and revocation as any paired
 * client, and lists only the query tools.
 */
export const QUERY_MCP_PATH = "/mcp/query";

const failure = (status: 401 | 403, error: string, message: string) =>
  HttpServerResponse.jsonUnsafe(
    { error, message },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
      },
    },
  );

const unauthorized = failure(
  401,
  "invalid_token",
  "A T3 Code access token with orchestration:read is required. Create one in Settings → Connections → Agent access, or run `t3 auth session issue --read-only`.",
);

const forbidden = failure(
  403,
  "insufficient_scope",
  "This access token cannot read orchestration history. Create a token with orchestration:read.",
);

type QueryHttpEffect = Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>;

const QueryAuthMiddlewareLive = HttpRouter.middleware()(
  EnvironmentAuth.EnvironmentAuth.pipe(
    Effect.map((auth) =>
      Effect.fn("QueryMcpServer.authenticateRequest")(function* (httpEffect: QueryHttpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        // Only an explicit Authorization header counts. A browser that visits
        // this origin carries the session cookie, and must not be able to read
        // history through it from another page.
        if (request.headers.authorization === undefined) {
          return unauthorized;
        }
        const headerOnly = request.modify({
          headers: Headers.remove(request.headers, "cookie"),
        });
        const session = yield* auth.authenticateHttpRequest(headerOnly).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("rejected query MCP request", { errorTag: error._tag }),
          ),
          Effect.option,
        );
        if (session._tag === "None") {
          return unauthorized;
        }
        if (!session.value.scopes.includes(AuthOrchestrationReadScope)) {
          return forbidden;
        }
        return yield* httpEffect.pipe(Effect.map(normalizeMcpHttpResponse));
      }),
    ),
  ),
).layer;

const QueryTransportLive = McpServer.layerHttp({
  name: "T3 Code history",
  version: packageJson.version,
  description:
    "Read-only access to this T3 Code environment's projects, threads, turns, messages, plans, diffs and pull requests.",
  path: QUERY_MCP_PATH,
  protocols: [McpProtocol.v2025_06_18],
}).pipe(Layer.provide(QueryAuthMiddlewareLive));

/**
 * Fresh so this MCP server gets its own `McpServer` instance: layers are
 * memoized by reference, and sharing the one behind `/mcp` would list the
 * thread tools here and the query tools there.
 */
export const layer = Layer.fresh(
  McpServer.toolkit(QueryToolkit).pipe(
    Layer.provide(QueryToolkitHandlersLive),
    Layer.provideMerge(QueryTransportLive),
  ),
);
