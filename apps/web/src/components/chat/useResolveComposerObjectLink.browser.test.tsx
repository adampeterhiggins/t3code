import { parseComposerObjectLink } from "@t3tools/shared/composerObjectLinks";
import {
  EnvironmentId,
  ThreadId,
  type GranolaNoteContext,
  type NotionPageContext,
  type SlackThreadContext,
} from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  slackEnabled: true,
  notionEnabled: true,
  granolaEnabled: true,
  getSlackThread: vi.fn(),
  getNotionPage: vi.fn(),
  getGranolaNote: vi.fn(),
  getPullRequest: vi.fn(),
  getPullRequestActivity: vi.fn(),
  getFreshPullRequestActivity: vi.fn(),
  pullRequestTarget: null as unknown,
  upsert: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentSettings: (
    _environmentId: unknown,
    select: (settings: {
      enableSlackIntegration: boolean;
      enableNotionIntegration: boolean;
      enableGranolaIntegration: boolean;
    }) => boolean,
  ) =>
    select({
      enableSlackIntegration: mocks.slackEnabled,
      enableNotionIntegration: mocks.notionEnabled,
      enableGranolaIntegration: mocks.granolaEnabled,
    }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("~/state/entities", () => ({ useProjects: () => [] }));
vi.mock("~/state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("~/state/slack", () => ({ slackEnvironment: { getThread: "slack" } }));
vi.mock("~/state/linear", () => ({ linearEnvironment: { getIssue: "linear" } }));
vi.mock("~/state/githubIssues", () => ({ githubIssueEnvironment: { getIssue: "github" } }));
vi.mock("~/state/notion", () => ({ notionEnvironment: { getPage: "notion" } }));
vi.mock("~/state/granola", () => ({ granolaEnvironment: { getNote: "granola" } }));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: { detail: "detail", activity: "activity" },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "slack"
      ? mocks.getSlackThread
      : command === "notion"
        ? mocks.getNotionPage
        : command === "granola"
          ? mocks.getGranolaNote
          : vi.fn(),
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (family: string, options?: { readonly refresh?: boolean }) =>
    family === "detail"
      ? mocks.getPullRequest
      : family !== "activity"
        ? vi.fn()
        : options?.refresh === true
          ? mocks.getFreshPullRequestActivity
          : mocks.getPullRequestActivity,
}));
vi.mock("~/issueContextStore", () => ({
  useIssueContextStore: { getState: () => ({ upsert: mocks.upsert }) },
}));
vi.mock("~/repositoryContextStore", () => ({
  useRepositoryContextStore: { getState: () => ({ upsert: mocks.upsert }) },
}));
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: {} }));
vi.mock("~/lib/openPullRequestLink", () => ({
  resolvePullRequestPreviewTarget: () => mocks.pullRequestTarget,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));

import { useResolveComposerObjectLink } from "./useResolveComposerObjectLink";

const threadRef = {
  environmentId: EnvironmentId.make("test-environment"),
  threadId: ThreadId.make("test-thread"),
};
const url = "https://acme.slack.com/archives/C04ABCD12/p1727779620000100";
const link = parseComposerObjectLink(url)!;
const thread: SlackThreadContext = {
  teamId: "T1",
  channelId: "C04ABCD12",
  channelLabel: "#general",
  ts: "1727779620.000100",
  threadTs: null,
  url,
  authorName: "Alice",
  title: "A message",
  replyCount: 0,
  scope: "thread",
  markdown: "Alice: A message",
};

const notionUrl =
  "https://app.notion.com/p/acme/Methodology-28599cd1efb78275839b01b59665ef86?source=copy_link";
const notionLink = parseComposerObjectLink(notionUrl)!;
const notionPage: NotionPageContext = {
  id: "28599cd1-efb7-8275-839b-01b59665ef86",
  title: "Methodology",
  url: notionUrl,
  updatedAt: "2026-10-06T00:00:00.000Z",
  markdown: "# Methodology",
};

const granolaUrl = "https://notes.granola.ai/d/abd3f11c-e46a-4467-bfff-9a06519ef066";
const granolaLink = parseComposerObjectLink(granolaUrl)!;
const granolaNote: GranolaNoteContext = {
  id: "abd3f11c-e46a-4467-bfff-9a06519ef066",
  title: "Weekly sync",
  url: granolaUrl,
  meetingAt: "2026-10-12T09:30:00.000+01:00",
  participants: ["Ada", "Grace"],
  creator: "Ada",
  markdown: "# Weekly sync",
};

let renderer: Root;
let resolveLink: ReturnType<typeof useResolveComposerObjectLink>;

function Probe() {
  const resolve = useResolveComposerObjectLink({ threadRef, draftTarget: threadRef });
  useLayoutEffect(() => {
    resolveLink = resolve;
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.slackEnabled = true;
  mocks.notionEnabled = true;
  mocks.granolaEnabled = true;
  mocks.pullRequestTarget = null;
  mocks.getGranolaNote.mockResolvedValue({ _tag: "Success", value: granolaNote });
  mocks.getNotionPage.mockResolvedValue({ _tag: "Success", value: notionPage });
  mocks.getSlackThread.mockResolvedValue({ _tag: "Success", value: thread });
  renderer = createRoot(document.createElement("div"));
  await act(() => renderer.render(<Probe />));
});

afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("Slack link attachments", () => {
  it("keeps repeated links as text without requesting Slack or showing setup prompts when disabled", async () => {
    mocks.slackEnabled = false;
    await act(() => renderer.render(<Probe />));

    expect(await resolveLink(link)).toBeNull();
    expect(await resolveLink(link)).toBeNull();
    expect(mocks.getSlackThread).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("can attach a Slack thread after re-enabling without reconnecting", async () => {
    mocks.slackEnabled = false;
    await act(() => renderer.render(<Probe />));
    expect(await resolveLink(link)).toBeNull();

    mocks.slackEnabled = true;
    await act(() => renderer.render(<Probe />));
    const attached = await resolveLink(link);
    expect(attached?.reference.kind).toBe("slack-thread");
    expect(mocks.getSlackThread).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { channelId: thread.channelId, ts: thread.ts, url, scope: "thread" },
    });
    attached!.commit();
    expect(mocks.upsert).toHaveBeenCalledWith(
      threadRef.threadId,
      expect.objectContaining({ kind: "slack-thread", markdown: thread.markdown }),
    );
  });

  it("continues resolving other links when Slack is disabled", async () => {
    mocks.slackEnabled = false;
    await act(() => renderer.render(<Probe />));
    const repository = parseComposerObjectLink("https://github.com/acme/project")!;
    const attached = await resolveLink(repository);
    expect(attached?.reference.kind).toBe("repository");
    expect(mocks.getSlackThread).not.toHaveBeenCalled();
  });
});

describe("Notion link attachments", () => {
  it("attaches a pasted app.notion.com page link", async () => {
    const attached = await resolveLink(notionLink);
    expect(attached?.reference.kind).toBe("notion-page");
    expect(mocks.getNotionPage).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { id: notionPage.id },
    });
  });

  it("keeps links as text without requesting Notion or showing setup prompts when disabled", async () => {
    mocks.notionEnabled = false;
    await act(() => renderer.render(<Probe />));

    expect(await resolveLink(notionLink)).toBeNull();
    expect(mocks.getNotionPage).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe("Granola link attachments", () => {
  it("attaches a pasted Granola note link", async () => {
    const attached = await resolveLink(granolaLink);
    expect(attached?.reference).toEqual({
      kind: "granola-note",
      contextId: `granola-note_${granolaNote.id}`,
      label: "Weekly sync",
    });
    expect(mocks.getGranolaNote).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { id: granolaNote.id },
    });
    attached!.commit();
    expect(mocks.upsert).toHaveBeenCalledWith(
      threadRef.threadId,
      expect.objectContaining({ kind: "granola-note", markdown: granolaNote.markdown }),
    );
  });

  it("keeps links as text without requesting Granola when disabled", async () => {
    mocks.granolaEnabled = false;
    await act(() => renderer.render(<Probe />));

    expect(await resolveLink(granolaLink)).toBeNull();
    expect(mocks.getGranolaNote).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe("pull request comment links", () => {
  const pullRequest = {
    number: 42,
    title: "Add the pull requests page",
    url: "https://github.com/pingdotgg/t3code/pull/42",
    headBranch: "feat/page",
    baseBranch: "main",
    state: "open",
    isDraft: false,
  };
  const commentUrl = `${pullRequest.url}/changes#r201`;
  const target = {
    environmentId: threadRef.environmentId,
    input: { projectId: "p1", repository: "pingdotgg/t3code", number: 42 },
  };
  const activity = (withComment: boolean) => ({
    _tag: "Success",
    value: {
      comments: [],
      reviewThreads: [
        {
          id: "t1",
          path: "apps/web/src/page.tsx",
          line: 12,
          side: "right",
          isResolved: false,
          isOutdated: false,
          comments: withComment
            ? [
                {
                  id: "RC_1",
                  author: { login: "theo", name: null, avatarUrl: null },
                  body: "rename the helper",
                  createdAt: "2026-07-02T00:00:00Z",
                  url: `${pullRequest.url}#discussion_r201`,
                },
              ]
            : [],
        },
      ],
    },
  });

  beforeEach(() => {
    mocks.pullRequestTarget = target;
    mocks.getPullRequest.mockResolvedValue({ _tag: "Success", value: pullRequest });
  });

  it("asks the host again for a comment newer than the shared read", async () => {
    mocks.getPullRequestActivity.mockResolvedValue(activity(false));
    mocks.getFreshPullRequestActivity.mockResolvedValue(activity(true));

    const attached = await resolveLink(parseComposerObjectLink(commentUrl)!);

    expect(mocks.getFreshPullRequestActivity).toHaveBeenCalledWith({
      ...target,
      input: { ...target.input, allowStale: false },
    });
    expect(attached?.reference.label).toBe("page.tsx L12");
  });

  it("keeps a link to a comment the host does not have as text", async () => {
    mocks.getPullRequestActivity.mockResolvedValue(activity(false));
    mocks.getFreshPullRequestActivity.mockResolvedValue(activity(false));

    expect(await resolveLink(parseComposerObjectLink(commentUrl)!)).toBe(null);
  });
});
