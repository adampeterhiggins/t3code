import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Types from "effect/Types";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import packageJson from "../../../package.json" with { type: "json" };
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as McpActor from "../McpActor.ts";
import { normalizeMcpHttpResponse } from "../McpHttpServer.ts";
import { OPERATE_MCP_PATH, QUERY_MCP_PATH } from "../paths.ts";
import { OperateToolkitHandlersLive } from "../toolkits/operate/handlers.ts";
import { OperateToolkit } from "../toolkits/operate/tools.ts";
import { QueryToolkitHandlersLive } from "./handlers.ts";
import { QueryToolkit } from "./tools.ts";

/**
 * `/mcp/query` and `/mcp/operate` serve agents outside T3 Code, such as a
 * scheduled Claude Code run. They are separate MCP servers from `/mcp` on
 * purpose: `/mcp` is how an agent inside one thread acts, scoped to that
 * thread by a per-session token. These take an environment access token, the
 * same credential and revocation as any paired client. `/mcp/query` needs
 * `orchestration:read` and lists only the history tools; `/mcp/operate` needs
 * `orchestration:operate` too and adds the tools that start and drive threads.
 */
export { OPERATE_MCP_PATH, QUERY_MCP_PATH };

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

const unauthorized = (scope: AuthEnvironmentScope, flag: string) =>
  failure(
    401,
    "invalid_token",
    `A T3 Code access token with ${scope} is required. Create one in Settings → Connections → Agent access, or run \`t3 auth session issue ${flag}\`.`,
  );

const forbidden = (scope: AuthEnvironmentScope, what: string) =>
  failure(
    403,
    "insufficient_scope",
    `This access token cannot ${what}. Create a token with ${scope}.`,
  );

type TokenHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpActor.McpActor
>;

const tokenAuthMiddleware = (options: {
  readonly requiredScope: AuthEnvironmentScope;
  readonly cliFlag: string;
  readonly what: string;
}) =>
  HttpRouter.middleware<{ provides: McpActor.McpActor }>()(
    EnvironmentAuth.EnvironmentAuth.pipe(
      Effect.map((auth) =>
        Effect.fn("TokenMcpServer.authenticateRequest")(function* (httpEffect: TokenHttpEffect) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          // Only an explicit Authorization header counts. A browser that visits
          // this origin carries the session cookie, and must not be able to
          // reach these tools through it from another page.
          if (request.headers.authorization === undefined) {
            return unauthorized(options.requiredScope, options.cliFlag);
          }
          const headerOnly = request.modify({
            headers: Headers.remove(request.headers, "cookie"),
          });
          const session = yield* auth.authenticateHttpRequest(headerOnly).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("rejected token MCP request", { errorTag: error._tag }),
            ),
            Effect.option,
          );
          if (session._tag === "None") {
            return unauthorized(options.requiredScope, options.cliFlag);
          }
          if (
            !session.value.scopes.includes(AuthOrchestrationReadScope) ||
            !session.value.scopes.includes(options.requiredScope)
          ) {
            return forbidden(options.requiredScope, options.what);
          }
          return yield* httpEffect.pipe(
            Effect.provideService(McpActor.McpActor, {
              kind: "token",
              label: session.value.label ?? "Agent access token",
            }),
            Effect.map(normalizeMcpHttpResponse),
          );
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
}).pipe(
  Layer.provide(
    tokenAuthMiddleware({
      requiredScope: AuthOrchestrationReadScope,
      cliFlag: "--read-only",
      what: "read orchestration history",
    }),
  ),
);

const OperateTransportLive = McpServer.layerHttp({
  name: "T3 Code control",
  version: packageJson.version,
  description:
    "Read this T3 Code environment's history, and start, message, and wait on its threads as the user would.",
  path: OPERATE_MCP_PATH,
  protocols: [McpProtocol.v2025_06_18],
}).pipe(
  Layer.provide(
    tokenAuthMiddleware({
      requiredScope: AuthOrchestrationOperateScope,
      cliFlag: "--operate",
      what: "drive threads",
    }),
  ),
);

/**
 * Each server is fresh so it gets its own `McpServer` instance: layers are
 * memoized by reference, and sharing the one behind `/mcp` would list the
 * thread tools here and these tools there.
 */
export const layer = Layer.mergeAll(
  Layer.fresh(
    McpServer.toolkit(QueryToolkit).pipe(
      Layer.provide(QueryToolkitHandlersLive),
      Layer.provideMerge(QueryTransportLive),
    ),
  ),
  Layer.fresh(
    Layer.mergeAll(
      McpServer.toolkit(QueryToolkit).pipe(Layer.provide(QueryToolkitHandlersLive)),
      McpServer.toolkit(OperateToolkit).pipe(Layer.provide(OperateToolkitHandlersLive)),
    ).pipe(Layer.provideMerge(OperateTransportLive)),
  ),
);
