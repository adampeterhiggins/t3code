import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Types from "effect/Types";
import { McpProtocol } from "effect/ai";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import {
  layerEnvironmentRegistration,
  layerOrchestratorToolkit,
  layerProjectRegistration,
  layerThreadToolkit,
  normalizeMcpHttpResponse,
  toolkitRegistration,
  mcpHttpTransport,
} from "./McpHttpServer.ts";
import { OPERATE_MCP_PATH, QUERY_MCP_PATH } from "./paths.ts";
import { QueryToolkitHandlersLive } from "./query/handlers.ts";
import { QueryToolkit } from "./query/tools.ts";
import { ApprovalToolkitHandlersLive } from "./toolkits/approval/handlers.ts";
import { ApprovalToolkit } from "./toolkits/approval/tools.ts";

/**
 * `/mcp/query` and `/mcp/operate` serve agents outside T3 Code, such as a
 * scheduled Claude Code run, with an agent access token (Settings →
 * Connections → Agent access). They are separate MCP servers from `/mcp`,
 * where an agent inside one thread acts with a per-session credential.
 * `/mcp/query` needs `orchestration:read` and lists only the history tools.
 * `/mcp/operate` also needs `orchestration:operate`; it adds upstream's thread,
 * project, and environment tools, acting as a client caller with the token's
 * label, plus answering approvals. Fork-only; see docs/fork-differences.md.
 */

/** A token on `/mcp/operate` acts as the user, so it may hand threads any permission mode. */
const AGENT_ACCESS_RUNTIME_MODE_CEILING = "full-access";
const DEFAULT_TOKEN_LABEL = "Agent access token";

/** The invocation scope an agent access token gets on `/mcp/operate`. */
export function agentAccessInvocationScope(input: {
  readonly environmentId: EnvironmentId;
  readonly session: Pick<EnvironmentAuth.AuthenticatedSession, "sessionId" | "label">;
  readonly issuedAt: number;
}): McpInvocationContext.McpInvocationScope {
  return {
    environmentId: input.environmentId,
    // Thread-only capabilities (preview, device, worktree) need a calling thread.
    capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
    issuedAt: input.issuedAt,
    requestNamespace: `agent-access:${input.session.sessionId}`,
    thread: undefined,
    client: {
      sessionId: input.session.sessionId,
      label: input.session.label ?? DEFAULT_TOKEN_LABEL,
      access: AGENT_ACCESS_RUNTIME_MODE_CEILING,
    },
  };
}

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
  McpInvocationContext.McpInvocationContext
>;

const tokenAuthMiddleware = (options: {
  readonly requiredScope: AuthEnvironmentScope;
  readonly cliFlag: string;
  readonly what: string;
}) =>
  HttpRouter.middleware<{ provides: McpInvocationContext.McpInvocationContext }>()(
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const environment = yield* ServerEnvironment.ServerEnvironment;
      return Effect.fn("AgentAccessMcpServer.authenticateRequest")(function* (
        httpEffect: TokenHttpEffect,
      ) {
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
            Effect.logWarning("rejected agent access MCP request", { errorTag: error._tag }),
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
        const scope = agentAccessInvocationScope({
          environmentId: yield* environment.getEnvironmentId,
          session: session.value,
          issuedAt: yield* Clock.currentTimeMillis,
        });
        return yield* httpEffect.pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.map(normalizeMcpHttpResponse),
        );
      });
    }),
  ).layer;

const QueryTransportLive = mcpHttpTransport({
  name: "T3 Code history",
  version: packageJson.version,
  description:
    "Read-only access to this T3 Code environment's projects, threads, runs, messages, plans, diffs and pull requests.",
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

const OperateTransportLive = mcpHttpTransport({
  name: "T3 Code control",
  version: packageJson.version,
  description:
    "Read this T3 Code environment's history, and start, message, wait on, and answer its threads as the user would.",
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

const QueryToolkitRegistrationLive = toolkitRegistration(QueryToolkit, QueryToolkitHandlersLive);

/**
 * Each server is fresh so it gets its own `McpServer` instance: layers are
 * memoized by reference, and sharing the one behind `/mcp` would list the
 * thread tools on every endpoint.
 */
export const layer = Layer.mergeAll(
  Layer.fresh(QueryToolkitRegistrationLive.pipe(Layer.provideMerge(QueryTransportLive))),
  Layer.fresh(
    Layer.mergeAll(
      QueryToolkitRegistrationLive,
      layerOrchestratorToolkit,
      layerThreadToolkit,
      layerProjectRegistration,
      layerEnvironmentRegistration,
      toolkitRegistration(ApprovalToolkit, ApprovalToolkitHandlersLive),
    ).pipe(Layer.provideMerge(OperateTransportLive)),
  ),
);
