import { EnvironmentId, type GitHubIssueContext } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import "../index.css";

const environmentId = EnvironmentId.make("test-environment");
const issueUrl = "https://github.com/acme/frontend/issues/679";

type QueryView = { data: unknown; error: unknown; failure?: unknown };
const pending: QueryView = { data: null, error: null };
const mocks = vi.hoisted(() => ({
  pullRequest: { data: null, error: null } as QueryView,
  pullRequestPreview: { data: null, error: null } as QueryView,
  issueSummary: { data: null, error: null } as QueryView,
}));

const issue: GitHubIssueContext = {
  repository: "acme/frontend",
  number: 679,
  title: "Checkout drops the basket",
  url: issueUrl,
  state: "open",
  stateReason: null,
  authorLogin: "alice",
  assigneeLogins: [],
  labels: [],
  updatedAt: "2026-10-20T12:00:00.000Z",
  markdown: "The basket empties on refresh.",
};

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make({
    environment: { capabilities: { pullRequests: true, threadPullRequests: true } },
    availableEditors: [],
  });
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => config) as never },
  };
});
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    {
      id: "project-1",
      environmentId: "test-environment",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/frontend",
        provider: "github",
        owner: "acme",
        name: "frontend",
      },
    },
  ]) as never,
}));
vi.mock(import("../state/pullRequests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      detail: (() => "pull-request-detail") as never,
      preview: (() => "pull-request-preview") as never,
    },
  };
});
vi.mock(import("../state/githubIssues"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    githubIssueEnvironment: {
      ...actual.githubIssueEnvironment,
      issue: (() => "github-issue") as never,
      issueSummary: (() => "github-issue-summary") as never,
    },
  };
});
vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((atom: unknown) =>
    atom === "pull-request-detail"
      ? mocks.pullRequest
      : atom === "pull-request-preview"
        ? mocks.pullRequestPreview
        : atom === "github-issue-summary"
          ? mocks.issueSummary
          : { data: atom === "github-issue" ? issue : null, error: null }) as never,
}));

import ChatMarkdown from "./ChatMarkdown";

function setup(
  pullRequest: QueryView,
  lookups: { pullRequestPreview?: QueryView; issueSummary?: QueryView } = {},
) {
  mocks.pullRequest = pullRequest;
  mocks.pullRequestPreview = lookups.pullRequestPreview ?? pending;
  mocks.issueSummary = lookups.issueSummary ?? pending;
}

const notFound: QueryView = { data: null, error: "Not found", failure: { reason: "not-found" } };

function renderReference() {
  return render(
    <div style={{ padding: 200 }}>
      <ChatMarkdown cwd="/tmp/project" environmentId={environmentId} text={`[#679](${issueUrl})`} />
    </div>,
  );
}

describe("ChatMarkdown GitHub issue links", () => {
  it("previews an issue link that names a pull request as the pull request", async () => {
    setup({
      data: {
        repository: "acme/frontend",
        number: 679,
        title: "Serve the structured discussion guide",
        url: "https://github.com/acme/frontend/pull/679",
        state: "open",
        isDraft: true,
        author: { login: "alice", name: null },
        createdAt: "2026-10-20T12:00:00.000Z",
      },
      error: null,
    });
    await using _screen = await renderReference();

    await userEvent.hover(page.getByRole("link", { name: "#679" }));

    await expect
      .element(page.getByText("Serve the structured discussion guide"))
      .toBeInTheDocument();
  });

  it("previews an issue link that is not a pull request as the issue's chip card", async () => {
    setup({ data: null, error: new Error("not a pull request") });
    await using _screen = await renderReference();

    await userEvent.hover(page.getByRole("link", { name: "#679" }));

    await expect.element(page.getByText("The basket empties on refresh.")).toBeInTheDocument();
  });
});

describe("ChatMarkdown colour codes that may be issue numbers", () => {
  it("shows the colour once neither an issue nor a pull request has the number", async () => {
    setup(pending, { pullRequestPreview: notFound, issueSummary: notFound });
    await using _screen = await renderReference();

    await expect
      .element(page.getByRole("button", { name: "Colour #679. Show swatch" }))
      .toBeVisible();
    await expect.element(page.getByRole("link", { name: "#679" })).not.toBeInTheDocument();
  });

  it("keeps the reference when a pull request has the number, or the lookup cannot tell", async () => {
    setup(pending, {
      pullRequestPreview: { data: { number: 679 }, error: null },
      issueSummary: notFound,
    });
    await using screen = await renderReference();
    await expect.element(page.getByRole("link", { name: "#679" })).toBeVisible();

    setup(pending, {
      pullRequestPreview: notFound,
      issueSummary: { data: null, error: "Signed out", failure: { reason: "not-authenticated" } },
    });
    await screen.rerender(
      <div style={{ padding: 200 }}>
        <ChatMarkdown
          cwd="/tmp/project"
          environmentId={environmentId}
          text={`[#679](${issueUrl}) `}
        />
      </div>,
    );
    await expect.element(page.getByRole("link", { name: "#679" })).toBeVisible();
    expect(page.getByRole("button", { name: /^Colour/ }).elements()).toHaveLength(0);
  });
});
