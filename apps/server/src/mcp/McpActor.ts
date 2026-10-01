import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";

import type * as McpInvocationContext from "./McpInvocationContext.ts";

/**
 * Who is calling an MCP tool. An agent inside a thread holds that thread's
 * provider-session credential on `/mcp`; an agent outside T3 Code holds an
 * environment access token on `/mcp/operate`. Tools that act across threads
 * read this to decide what the caller may do, and to record who did it.
 */
export type McpActorValue =
  | {
      readonly kind: "thread";
      readonly threadId: ThreadId;
      readonly capabilities: ReadonlySet<McpInvocationContext.McpCapability>;
    }
  | {
      readonly kind: "token";
      /** The token's label from Settings → Connections → Agent access. */
      readonly label: string;
    };

export class McpActor extends Context.Service<McpActor, McpActorValue>()("t3/mcp/McpActor") {}

/** The thread actor for a `/mcp` credential. */
export const fromInvocation = (
  invocation: McpInvocationContext.McpInvocationScope,
): McpActorValue => ({
  kind: "thread",
  threadId: invocation.threadId,
  capabilities: invocation.capabilities,
});

/** Whether the actor may drive threads: a token on `/mcp/operate`, or a thread granted control. */
export const canOperate = (actor: McpActorValue): boolean =>
  actor.kind === "token" || actor.capabilities.has("orchestration");

/**
 * The `EnabledWhen` predicate for operate tools. MCP lists tools without
 * passing the request through, but the list and call handlers run on the
 * request's fiber, where the auth middleware put the actor. Reading it there
 * means an agent whose credential cannot operate never sees these tools, so
 * they cost it nothing in its context.
 */
export const operateToolsVisible = (): boolean => {
  const fiber = Fiber.getCurrent();
  if (fiber === undefined) return false;
  return Context.getOption(fiber.context, McpActor).pipe(
    Option.match({ onNone: () => false, onSome: canOperate }),
  );
};
