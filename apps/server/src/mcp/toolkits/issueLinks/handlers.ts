import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as GitHubIssueThreadLinks from "../../../githubIssues/GitHubIssueThreadLinks.ts";
import * as LinearThreadLinks from "../../../linear/LinearThreadLinks.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import {
  IssueLinkThreadNotFoundError,
  IssueLinkThreadRequiredError,
  IssueLinksToolkit,
} from "./tools.ts";

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const linear = yield* LinearThreadLinks.LinearThreadLinks;
  const github = yield* GitHubIssueThreadLinks.GitHubIssueThreadLinks;

  /**
   * The thread a call targets: `requested`, or the caller's own. Issue links ride the
   * pull-requests capability, since they are the same kind of thread-to-work link.
   */
  const requireThread = Effect.fnUntraced(function* (requested: ThreadId | undefined) {
    const scope = yield* McpInvocationContext.requireMcpCapability("pull-requests");
    const threadId = requested ?? scope.thread?.threadId;
    if (threadId === undefined) {
      return yield* new IssueLinkThreadRequiredError();
    }
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(unavailable));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new IssueLinkThreadNotFoundError({ threadId });
    }
    return thread.id;
  });

  /** A tool that changes `threadId`, or the caller's own thread when it is omitted. */
  const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
    handle: (params: P) => Effect.Effect<A, E, R>,
  ) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

  return {
    link_linear_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) =>
          linear.linkWithReplacement({ threadId, issueId: input.issue }),
        ),
      ),
    ),
    unlink_linear_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => linear.unlink({ threadId })),
        Effect.map((wasLinked) => ({ wasLinked })),
      ),
    ),
    link_github_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => github.linkWithReplacement({ threadId, url: input.url })),
      ),
    ),
    unlink_github_issue: writesThread((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap((threadId) => github.unlink({ threadId })),
        Effect.map((wasLinked) => ({ wasLinked })),
      ),
    ),
    list_thread_issues: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const threadId = yield* requireThread(input.threadId);
        return {
          linear: (yield* linear.forThread(threadId)) ?? null,
          github: (yield* github.forThread(threadId)) ?? null,
        };
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof IssueLinksToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(IssueLinksToolkit, make);
