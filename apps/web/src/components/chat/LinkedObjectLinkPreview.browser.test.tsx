import { EnvironmentId, type SlackThreadContext } from "@t3tools/contracts";
import { parseComposerObjectLink } from "@t3tools/source-control-definitions/composerObjectLinks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const mocks = vi.hoisted(() => ({
  slackEnabled: true,
  slackReads: [] as unknown[],
}));

const url = "https://acme.slack.com/archives/C04ABCD12/p1727779620000100";
const thread: SlackThreadContext = {
  teamId: "T1",
  channelId: "C04ABCD12",
  channelLabel: "#general",
  ts: "1727779620.000100",
  threadTs: null,
  url,
  authorName: "Alice",
  title: "Deploy is blocked",
  replyCount: 2,
  scope: "thread",
  markdown: "Alice: Deploy is blocked on the migration",
  messages: [
    {
      index: 0,
      authorName: "Alice",
      avatarUrl: null,
      postedAt: "2024-10-01T10:47:00.000Z",
      text: "Deploy is blocked on the migration",
      files: [],
      linked: false,
    },
  ],
};

vi.mock("~/hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/useSettings")>()),
  useEnvironmentSettings: (
    _environmentId: unknown,
    select: (settings: Record<string, boolean>) => boolean,
  ) =>
    select({
      enableSlackIntegration: mocks.slackEnabled,
      enableDiscordIntegration: true,
      enableNotionIntegration: true,
      enableGranolaIntegration: true,
    }),
}));
vi.mock("~/state/slack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/slack")>()),
  slackEnvironment: {
    thread: (args: unknown) => {
      mocks.slackReads.push(args);
      return "slack-thread";
    },
  },
}));
vi.mock("~/state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/query")>()),
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom === "slack-thread" ? thread : null,
    error: null,
  }),
}));
vi.mock("~/browser/useOpenLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/browser/useOpenLink")>()),
  useLinkClickHandler: () => () => {},
}));

import { LinkedObjectLinkPreview, isPreviewableObjectLink } from "./LinkedObjectLinkPreview";

let root: Root;
let container: HTMLDivElement;

async function renderLink() {
  const objectLink = parseComposerObjectLink(url);
  if (!isPreviewableObjectLink(objectLink)) throw new Error("expected a Slack message link");
  await act(async () => {
    root.render(
      <div style={{ padding: 200 }}>
        <LinkedObjectLinkPreview
          link={<a href={url}>the deploy thread</a>}
          objectLink={objectLink}
          environmentId={EnvironmentId.make("test-environment")}
          threadRef={null}
        />
      </div>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  mocks.slackEnabled = true;
  mocks.slackReads = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("LinkedObjectLinkPreview", () => {
  it("reads the Slack thread on hover and shows the card its chip would show", async () => {
    await renderLink();
    expect(mocks.slackReads).toEqual([]);

    await userEvent.hover(page.getByRole("link", { name: "the deploy thread" }));

    await expect.element(page.getByText("Deploy is blocked on the migration")).toBeInTheDocument();
    await expect.element(page.getByRole("link", { name: "Open in Slack" })).toBeInTheDocument();
    expect(mocks.slackReads).toContainEqual(
      expect.objectContaining({
        input: expect.objectContaining({ channelId: "C04ABCD12", ts: "1727779620.000100" }),
      }),
    );
  });

  it("shows the link's URL without reading Slack when the integration is off", async () => {
    mocks.slackEnabled = false;
    await renderLink();

    await userEvent.hover(page.getByRole("link", { name: "the deploy thread" }));

    await expect.element(page.getByText(url, { exact: true })).toBeInTheDocument();
    expect(mocks.slackReads).toEqual([]);
  });
});
