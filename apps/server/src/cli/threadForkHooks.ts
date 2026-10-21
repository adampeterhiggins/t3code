/**
 * Fork-only pieces that upstream's `t3 thread` commands in `thread.ts` call
 * into. They live here, not in `threadFork.ts`, because `threadFork.ts`
 * imports `thread.ts` and building commands across a cycle hits TDZ errors.
 */
import { AuthAgentOperateScopes } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Flag } from "effect/cli";

import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";

/** Revoked when the command ends; the TTL bounds a killed CLI yet outlasts a long --wait. */
const OPERATE_SESSION_TTL = Duration.days(1);

/**
 * `/mcp/operate` serves the fork's user-only tools (answering approvals,
 * deleting threads) but not the draft tools, which stay on `/mcp`. It refuses
 * MCP client sessions, taking the agent access token
 * `t3 auth session issue --operate` makes.
 */
export const issueOperateSession = (environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"]) =>
  environmentAuth.issueSession({
    label: "t3 thread cli",
    scopes: AuthAgentOperateScopes,
    ttl: OPERATE_SESSION_TTL,
  });

/** OrchestratorMcpFailure carries `message`; the draft tools' MessageDraftError carries `detail`. */
export const ToolFailureText = Schema.Struct({
  message: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});

export const linkFlag = Flag.String("link").pipe(
  Flag.withDescription(
    "Attach a link as context, as a paste into the composer would: a Linear issue (URL or ENG-123), GitHub issue, Slack thread, Notion page, and more. Repeatable.",
  ),
  Flag.atLeast(0),
);

const LINEAR_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/u;

/**
 * The server reads a Linear issue by its identifier alone, so a bare `ENG-123`
 * becomes a link under any workspace slug.
 */
export const contextLinksArgument = (links: ReadonlyArray<string>) =>
  links.length === 0
    ? {}
    : {
        contextLinks: links.map((link) => {
          const trimmed = link.trim();
          return LINEAR_IDENTIFIER.test(trimmed)
            ? `https://linear.app/_/issue/${trimmed.toUpperCase()}`
            : trimmed;
        }),
      };

export const pullRequestFlag = Flag.String("pr").pipe(
  Flag.withDescription(
    "Start from a pull request (URL or number): check out its branch in a worktree, reusing one that has it.",
  ),
  Flag.optional,
);

/**
 * Wraps upstream's `--worktree`/`--branch` strategy so its usage errors still
 * come first, then swaps in the pull request when `--pr` was passed. The usage
 * error class is passed in because it lives in `thread.ts`.
 */
export const orPullRequest =
  <U>(pr: Option.Option<string>, UsageError: new (input: { readonly detail: string }) => U) =>
  <A, E, R>(worktreeStrategy: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const strategy = yield* worktreeStrategy;
      if (Option.isNone(pr)) return strategy;
      if (strategy !== undefined) {
        return yield* Effect.fail(new UsageError({ detail: "Pass --pr or --worktree, not both." }));
      }
      return { type: "pull_request" as const, reference: pr.value };
    });
