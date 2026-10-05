import { parseComposerObjectLink } from "@t3tools/client-runtime/composer-object-links";
import { EnvironmentId, ThreadId, type SlackThreadContext } from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  slackEnabled: true,
  getSlackThread: vi.fn(),
  upsert: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentSettings: () => mocks.slackEnabled,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("~/state/entities", () => ({ useProjects: () => [] }));
vi.mock("~/state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("~/state/slack", () => ({ slackEnvironment: { getThread: "slack" } }));
vi.mock("~/state/linear", () => ({ linearEnvironment: { getIssue: "linear" } }));
vi.mock("~/state/githubIssues", () => ({ githubIssueEnvironment: { getIssue: "github" } }));
vi.mock("~/state/notion", () => ({ notionEnvironment: { getPage: "notion" } }));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: { detail: "detail", activity: "activity" },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "slack" ? mocks.getSlackThread : vi.fn()),
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("~/issueContextStore", () => ({
  useIssueContextStore: { getState: () => ({ upsert: mocks.upsert }) },
}));
vi.mock("~/repositoryContextStore", () => ({
  useRepositoryContextStore: { getState: () => ({ upsert: mocks.upsert }) },
}));
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: {} }));
vi.mock("~/lib/openPullRequestLink", () => ({ resolvePullRequestPreviewTarget: () => null }));
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

let renderer: ReactTestRenderer;
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
  mocks.getSlackThread.mockResolvedValue({ _tag: "Success", value: thread });
  await act(() => {
    renderer = create(<Probe />);
  });
});

afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("Slack link attachments", () => {
  it("keeps repeated links as text without requesting Slack or showing setup prompts when disabled", async () => {
    mocks.slackEnabled = false;
    await act(() => renderer.update(<Probe />));

    expect(await resolveLink(link)).toBeNull();
    expect(await resolveLink(link)).toBeNull();
    expect(mocks.getSlackThread).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("can attach a Slack thread after re-enabling without reconnecting", async () => {
    mocks.slackEnabled = false;
    await act(() => renderer.update(<Probe />));
    expect(await resolveLink(link)).toBeNull();

    mocks.slackEnabled = true;
    await act(() => renderer.update(<Probe />));
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
    await act(() => renderer.update(<Probe />));
    const repository = parseComposerObjectLink("https://github.com/acme/project")!;
    const attached = await resolveLink(repository);
    expect(attached?.reference.kind).toBe("repository");
    expect(mocks.getSlackThread).not.toHaveBeenCalled();
  });
});
