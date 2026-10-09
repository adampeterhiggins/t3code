import {
  EnvironmentId,
  type GitHubIssueThreadLink,
  type LinearThreadLink,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as GitHubIssueThreadLinks from "../../../githubIssues/GitHubIssueThreadLinks.ts";
import * as LinearThreadLinks from "../../../linear/LinearThreadLinks.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as IssueLinksHandlers from "./handlers.ts";
import { IssueLinksToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");
const LINKED_AT = "2026-10-01T00:00:00.000Z";

const threadCaller = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread: {
    threadId: THREAD_ID,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const outsideClient: McpInvocationContext.McpInvocationScope = {
  ...threadCaller(["orchestration", "pull-requests"]),
  requestNamespace: "client:session-1",
  thread: undefined,
  client: { sessionId: "session-1", label: "Outside agent", access: "full-access" },
};

/** In-memory link stores keyed by thread; tab groups are the services' own concern. */
const makeHarness = () => {
  const linear = new Map<ThreadId, LinearThreadLink>();
  const github = new Map<ThreadId, GitHubIssueThreadLink>();
  const layerDependencies = Layer.mergeAll(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(
          threadId === THREAD_ID || threadId === OTHER_THREAD_ID
            ? McpToolAccessTestkit.liveThreadShell(threadId)
            : null,
        ),
    }),
    Layer.mock(LinearThreadLinks.LinearThreadLinks)({
      linkWithReplacement: ({ threadId, issueId }) =>
        Effect.sync(() => {
          const link: LinearThreadLink = {
            groupId: threadId,
            threadIds: [threadId],
            issueId: `uuid-${issueId}`,
            identifier: issueId,
            title: `Issue ${issueId}`,
            url: `https://linear.app/acme/issue/${issueId}`,
            linkedAt: LINKED_AT,
          };
          const previous = linear.get(threadId);
          linear.set(threadId, link);
          return {
            link,
            replacedUrl: previous && previous.issueId !== link.issueId ? previous.url : null,
          };
        }),
      unlink: ({ threadId }) => Effect.sync(() => linear.delete(threadId)),
      forThread: (threadId) => Effect.sync(() => linear.get(threadId)),
    }),
    Layer.mock(GitHubIssueThreadLinks.GitHubIssueThreadLinks)({
      linkWithReplacement: ({ threadId, url }) =>
        Effect.sync(() => {
          const link: GitHubIssueThreadLink = {
            groupId: threadId,
            threadIds: [threadId],
            repository: "acme/app",
            number: Number(url.split("/").at(-1)),
            title: "Issue",
            url,
            linkedAt: LINKED_AT,
          };
          const previous = github.get(threadId);
          github.set(threadId, link);
          return {
            link,
            replacedUrl:
              previous &&
              (previous.repository !== link.repository || previous.number !== link.number)
                ? previous.url
                : null,
          };
        }),
      unlink: ({ threadId }) => Effect.sync(() => github.delete(threadId)),
      forThread: (threadId) => Effect.sync(() => github.get(threadId)),
    }),
  );
  const call = <Name extends keyof typeof IssueLinksToolkit.tools>(
    name: Name,
    params: Tool.Parameters<(typeof IssueLinksToolkit.tools)[Name]>,
    scope: McpInvocationContext.McpInvocationScope = threadCaller([
      "orchestration",
      "pull-requests",
    ]),
  ) =>
    IssueLinksToolkit.pipe(
      Effect.flatMap((toolkit) => toolkit.handle(name, params as never)),
      Stream.unwrap,
      Stream.runCollect,
      // Failure mode is "error", so a delivered result is always the success shape.
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof IssueLinksToolkit.tools)[Name]>,
      ),
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(IssueLinksHandlers.layer).pipe(
          Layer.provide(layerDependencies),
        ),
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.provide(layerDependencies),
    );
  return { linear, github, call };
};

describe("issue link toolkit handlers", () => {
  it.effect("refuses a credential without the pull-requests capability", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const error = yield* harness
        .call("link_linear_issue", { issue: "ENG-1" }, threadCaller(["orchestration"]))
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "pull-requests",
      });
      expect(harness.linear.size).toBe(0);
    }),
  );

  it.effect("links, replaces, lists, and unlinks a Linear issue on the caller's thread", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const first = yield* harness.call("link_linear_issue", { issue: "ENG-1" });
      expect(first).toMatchObject({
        link: { groupId: THREAD_ID, identifier: "ENG-1" },
        replacedUrl: null,
      });

      const relinked = yield* harness.call("link_linear_issue", { issue: "ENG-1" });
      expect(relinked.replacedUrl).toBeNull();

      const replaced = yield* harness.call("link_linear_issue", { issue: "ENG-2" });
      expect(replaced).toMatchObject({
        link: { identifier: "ENG-2" },
        replacedUrl: "https://linear.app/acme/issue/ENG-1",
      });

      expect(yield* harness.call("list_thread_issues", {})).toMatchObject({
        linear: { identifier: "ENG-2" },
        github: null,
      });

      expect(yield* harness.call("unlink_linear_issue", {})).toEqual({ wasLinked: true });
      expect(yield* harness.call("unlink_linear_issue", {})).toEqual({ wasLinked: false });
    }),
  );

  it.effect("links a GitHub issue to another thread and refuses an unknown one", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const url = "https://github.com/acme/app/issues/7";
      const linked = yield* harness.call("link_github_issue", { threadId: OTHER_THREAD_ID, url });
      expect(linked).toMatchObject({
        link: { groupId: OTHER_THREAD_ID, number: 7 },
        replacedUrl: null,
      });
      expect(harness.github.has(THREAD_ID)).toBe(false);
      expect(yield* harness.call("unlink_github_issue", { threadId: OTHER_THREAD_ID })).toEqual({
        wasLinked: true,
      });

      const missing = yield* harness
        .call("link_github_issue", { threadId: ThreadId.make("missing"), url })
        .pipe(Effect.flip);
      expect(missing).toMatchObject({
        _tag: "IssueLinkThreadNotFoundError",
        threadId: "missing",
      });
      expect(harness.github.size).toBe(0);
    }),
  );

  it.effect("needs threadId from a client outside a thread", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const error = yield* harness.call("list_thread_issues", {}, outsideClient).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "IssueLinkThreadRequiredError" });
      expect(
        yield* harness.call("list_thread_issues", { threadId: THREAD_ID }, outsideClient),
      ).toEqual({ linear: null, github: null });
    }),
  );

  it.effect("refuses writes from a read-only client", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const error = yield* harness
        .call(
          "unlink_github_issue",
          { threadId: THREAD_ID },
          { ...outsideClient, client: { ...outsideClient.client!, access: "read-only" } },
        )
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "capability_denied" });
    }),
  );
});
