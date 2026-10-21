import {
  EnvironmentId,
  type GitHubIssueThreadLink,
  type LinearIssueContext,
  type LinearListIssuesInput,
  type LinearThreadLink,
  type NotionThreadLink,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as DiscordThreadLinks from "../../../discord/DiscordThreadLinks.ts";
import * as GitHubIssueThreadLinks from "../../../githubIssues/GitHubIssueThreadLinks.ts";
import * as GranolaThreadLinks from "../../../granola/GranolaThreadLinks.ts";
import * as LinearApi from "../../../linear/LinearApi.ts";
import * as LinearThreadLinks from "../../../linear/LinearThreadLinks.ts";
import * as NotionThreadLinks from "../../../notion/NotionThreadLinks.ts";
import * as SlackThreadLinks from "../../../slack/SlackThreadLinks.ts";
import * as McpContextLinks from "../../McpContextLinks.ts";
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
  const issueReads: Array<string> = [];
  const searches: Array<LinearListIssuesInput> = [];
  const notion = new Map<ThreadId, NotionThreadLink>();
  const layerDependencies = Layer.mergeAll(
    Layer.mock(SlackThreadLinks.SlackThreadLinks)({ forThread: () => Effect.succeed(undefined) }),
    Layer.mock(DiscordThreadLinks.DiscordThreadLinks)({
      forThread: () => Effect.succeed(undefined),
    }),
    Layer.mock(NotionThreadLinks.NotionThreadLinks)({
      forThread: (threadId) => Effect.sync(() => notion.get(threadId)),
    }),
    Layer.mock(GranolaThreadLinks.GranolaThreadLinks)({
      forThread: () => Effect.succeed(undefined),
    }),
    Layer.mock(McpContextLinks.McpContextLinks)({
      read: (url) =>
        Effect.succeed({
          version: 1,
          kind: "notion-page",
          contextId: "notion-page_page-1",
          label: "Plan",
          pageId: "page-1",
          title: "Plan",
          url,
          markdown: "The plan.",
        } as never),
    }),
    Layer.mock(LinearApi.LinearApi)({
      getIssue: ({ id }) =>
        Effect.sync((): LinearIssueContext => {
          issueReads.push(id);
          return {
            id,
            identifier: id,
            title: `Issue ${id}`,
            url: `https://linear.app/acme/issue/${id}`,
            stateName: "In Progress",
            stateType: "started",
            stateColor: "#f2c94c",
            priorityLabel: null,
            assigneeName: null,
            updatedAt: LINKED_AT,
            markdown: `# ${id}`,
          };
        }),
      listIssues: (input) =>
        Effect.sync(() => {
          searches.push(input);
          return { issues: [] };
        }),
    }),
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
  return { linear, github, notion, issueReads, searches, call };
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

      expect(yield* harness.call("list_thread_links", {})).toMatchObject({
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
      const error = yield* harness.call("list_thread_links", {}, outsideClient).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "IssueLinkThreadRequiredError" });
      expect(
        yield* harness.call("list_thread_links", { threadId: THREAD_ID }, outsideClient),
      ).toEqual({
        linear: null,
        github: null,
        slack: null,
        discord: null,
        notion: null,
        granola: null,
      });
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

  it.effect("reads the linked Linear issue, or a named one, through T3's connection", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const unlinked = yield* harness.call("read_linear_issue", {}).pipe(Effect.flip);
      expect(unlinked).toMatchObject({ _tag: "NoLinkedLinearIssueError", threadId: THREAD_ID });

      yield* harness.call("link_linear_issue", { issue: "ENG-1" });
      expect(yield* harness.call("read_linear_issue", {})).toMatchObject({
        markdown: "# uuid-ENG-1",
      });
      expect(yield* harness.call("read_linear_issue", { issue: "ENG-9" })).toMatchObject({
        identifier: "ENG-9",
      });
      // A named issue needs no thread, so an outside client can read one.
      yield* harness.call("read_linear_issue", { issue: "ENG-10" }, outsideClient);
      expect(harness.issueReads).toEqual(["uuid-ENG-1", "ENG-9", "ENG-10"]);
    }),
  );

  it.effect("searches with partial filters and refuses without the capability", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* harness.call("search_linear_issues", {});
      yield* harness.call("search_linear_issues", {
        query: "cache",
        filters: { assigneeIds: ["me"] },
      });
      expect(harness.searches).toEqual([
        { query: undefined, filters: undefined, sort: undefined },
        {
          query: "cache",
          filters: {
            assigneeIds: ["me"],
            teamIds: [],
            projectIds: [],
            milestoneIds: [],
            stateNames: [],
            priorities: [],
            labelNames: [],
            includeClosed: false,
          },
          sort: undefined,
        },
      ]);

      const error = yield* harness
        .call("search_linear_issues", { query: "cache" }, threadCaller(["orchestration"]))
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "McpCapabilityUnavailableError" });
      expect(harness.searches).toHaveLength(2);
    }),
  );

  it.effect("lists every kind of thread link and reads one by its url", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const url = "https://www.notion.so/acme/Plan-0123456789abcdef0123456789abcdef";
      harness.notion.set(THREAD_ID, {
        groupId: THREAD_ID,
        threadIds: [THREAD_ID],
        pageId: "page-1",
        title: "Plan",
        url,
        linkedAt: LINKED_AT,
      });
      const links = yield* harness.call("list_thread_links", {});
      expect(links.notion).toMatchObject({ title: "Plan", url });

      const read = yield* harness.call("read_context_link", { url: links.notion!.url });
      expect(read).toEqual({
        kind: "notion-page",
        url,
        text: `notion page: Plan\nurl: ${url}\nThe plan.`,
      });
    }),
  );
});
