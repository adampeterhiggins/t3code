import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import "~/index.css";
import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({
  observeSource: vi.fn(),
  dispose: vi.fn(),
  threads: [] as unknown[],
  projects: [] as unknown[],
}));
vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () => mocks.projects as never,
  useThreadShells: () => mocks.threads as never,
  useThreadShell: (ref) =>
    (ref
      ? mocks.threads.find((thread) => (thread as { id: string }).id === ref.threadId)
      : null) as never,
}));
vi.mock(import("./AssistantCitationSource"), async (importOriginal) => ({
  ...(await importOriginal()),
  observeAssistantCitationCommentSource: mocks.observeSource,
}));
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
  Link: (({ children }: { children: ReactNode }) => <a>{children}</a>) as never,
}));

import { AssistantCitationChip } from "./AssistantCitationChip";
import type { AssistantCitationDestinations } from "./AssistantCitationCommentEditor";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("source"),
  text: "hello",
  start: 0,
  end: 5,
  prefix: "",
  suffix: "",
};

// The mocked source observer is shared, so every test starts by resetting it.
function setup() {
  mocks.observeSource.mockReset().mockReturnValue(mocks.dispose);
  mocks.dispose.mockClear();
  mocks.threads = [];
  mocks.projects = [];
  const source = document.createElement("p");
  source.textContent = "hello";
  document.body.append(source);
  const range = document.createRange();
  range.selectNodeContents(source);
  const sourceAnchor = { source, range, viewport: document.body } as AssistantCitationSourceAnchor;
  return { sourceAnchor, [Symbol.dispose]: () => source.remove() };
}

function mount(
  sourceAnchor: AssistantCitationSourceAnchor,
  onSave: (comment: string) => boolean,
  onSaveAndSend?: (comment: string) => boolean,
  destinations?: AssistantCitationDestinations,
) {
  function Composer() {
    const [open, setOpen] = useState(true);
    return (
      <AssistantCitationChip
        citation={citation}
        composer
        commentEditor={{
          open,
          sourceAnchor,
          onOpenChange: setOpen,
          onSave,
          ...(onSaveAndSend ? { onSaveAndSend } : {}),
          ...(destinations ? { destinations } : {}),
        }}
      />
    );
  }
  return render(<Composer />);
}

const textarea = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment on selected text"]');

async function typeComment(value: string) {
  const input = textarea()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function removeSource() {
  const { onUnavailable } = mocks.observeSource.mock.lastCall![0];
  await act(async () => onUnavailable());
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

async function pressEnter(modifier = false) {
  await act(async () =>
    textarea()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: modifier, bubbles: true }),
    ),
  );
}

describe("citation comment source disappearance", () => {
  it("preserves an over-length draft at the composer until it can be shortened and saved", async () => {
    using source = setup();
    const onSave = vi.fn(() => true);
    await using _screen = await mount(source.sourceAnchor, onSave);
    const draft = "x".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1);
    await typeComment(draft);
    await removeSource();

    expect(textarea()?.value).toBe(draft);
    expect(textarea()?.getAttribute("aria-invalid")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalled();
    expect(mocks.observeSource).toHaveBeenCalledTimes(1);

    await typeComment("shortened comment");
    await clickButton("Save");
    expect(onSave).toHaveBeenCalledWith("shortened comment");
    expect(textarea()).toBeNull();
  });

  it("preserves a rejected save and allows a later retry", async () => {
    using source = setup();
    const onSave = vi.fn(() => false);
    await using _screen = await mount(source.sourceAnchor, onSave);
    await typeComment("keep this draft");
    await removeSource();

    expect(onSave).toHaveBeenCalledWith("keep this draft");
    expect(textarea()?.value).toBe("keep this draft");
    onSave.mockReturnValue(true);
    await clickButton("Save");
    expect(onSave).toHaveBeenLastCalledWith("keep this draft");
    expect(textarea()).toBeNull();
  });
});

describe("citation comment Enter", () => {
  async function mountWithChoice(storedChoice: "send" | "save" | null) {
    localStorage.clear();
    if (storedChoice) {
      localStorage.setItem("t3code:citation-comment-submit:v1", JSON.stringify(storedChoice));
    }
    const source = setup();
    const onSave = vi.fn((_comment: string) => true);
    const onSaveAndSend = vi.fn((_comment: string) => true);
    const screen = await mount(source.sourceAnchor, onSave, onSaveAndSend);
    await typeComment("comment");
    return { source, screen, onSave, onSaveAndSend };
  }

  it("sends when the split button shows Send", async () => {
    const mounted = await mountWithChoice(null);
    using _source = mounted.source;
    await using _screen = mounted.screen;
    await pressEnter();
    expect(mounted.onSaveAndSend).toHaveBeenCalledWith("comment");
    expect(mounted.onSave).not.toHaveBeenCalled();
  });

  it("saves when the split button shows Save", async () => {
    const mounted = await mountWithChoice("save");
    using _source = mounted.source;
    await using _screen = mounted.screen;
    await pressEnter();
    expect(mounted.onSave).toHaveBeenCalledWith("comment");
    expect(mounted.onSaveAndSend).not.toHaveBeenCalled();
  });

  it("does the other choice with Command/Ctrl", async () => {
    const mounted = await mountWithChoice("save");
    using _source = mounted.source;
    await using _screen = mounted.screen;
    await pressEnter(true);
    expect(mounted.onSaveAndSend).toHaveBeenCalledWith("comment");
    expect(mounted.onSave).not.toHaveBeenCalled();
  });
});

const destinationDefaults = {
  environmentId: citation.environmentId,
  threadId: citation.threadId,
  projectId: ProjectId.make("current-project"),
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
};

function project(id: string, title: string) {
  return {
    environmentId: citation.environmentId,
    id: ProjectId.make(id),
    title,
    workspaceRoot: `/repo/${id}`,
    faviconPath: null,
    projectIcon: { kind: "monogram", text: title[0], color: "blue" },
  };
}

async function clickItem(text: string) {
  const item = await vi.waitFor(() => {
    const match = [...document.querySelectorAll("[data-slot=command-item]")].find((element) =>
      element.textContent?.includes(text),
    );
    expect(match, `item ${text}`).toBeDefined();
    return match as HTMLElement;
  });
  await act(async () => item.click());
}

describe("citation comment destinations", () => {
  it("starts a new thread in the picked project with this thread's model", async () => {
    localStorage.clear();
    using source = setup();
    mocks.projects = [project("current-project", "t3code"), project("website", "website")];
    const onSubmit = vi.fn(() => true);
    await using _screen = await mount(
      source.sourceAnchor,
      vi.fn(() => true),
      vi.fn(() => true),
      {
        ...destinationDefaults,
        followUpBehavior: "queue",
        onSubmit,
      },
    );
    await typeComment("try it there");

    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Send citation to: This thread"]')!
        .click(),
    );
    await clickItem("New thread");
    await clickItem("website");

    await expect
      .element(page.getByRole("button", { name: /^Send citation to: New thread in website with/ }))
      .toBeInTheDocument();
    await clickButton("Start thread");
    expect(onSubmit).toHaveBeenCalledWith(
      {
        kind: "new-thread",
        projectId: "website",
        modelSelection: destinationDefaults.modelSelection,
      },
      "send",
      "try it there",
    );
  });

  it("sends the quote to the chosen thread, queueing behind its running turn", async () => {
    localStorage.clear();
    using source = setup();
    mocks.threads = [
      {
        environmentId: citation.environmentId,
        id: ThreadId.make("target"),
        projectId: "project",
        title: "Fix WS reconnect backoff",
        runtime: { status: "running", activeRunId: "run" },
        archivedAt: null,
        hiddenAt: null,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ];
    const onSave = vi.fn(() => true);
    const onSaveAndSend = vi.fn(() => true);
    const onSubmit = vi.fn(() => true);
    await using _screen = await mount(source.sourceAnchor, onSave, onSaveAndSend, {
      ...destinationDefaults,
      followUpBehavior: "queue",
      onSubmit,
    });
    await typeComment("fix it there");

    const picker = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Send citation to: This thread"]',
    );
    await act(async () => picker!.click());
    const target = await vi.waitFor(() => {
      const item = [...document.querySelectorAll("[data-slot=command-item]")].find((element) =>
        element.textContent?.includes("Fix WS reconnect backoff"),
      );
      expect(item).toBeDefined();
      return item as HTMLElement;
    });
    await act(async () => target.click());

    await clickButton("Add to queue");
    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "thread", threadId: "target", title: "Fix WS reconnect backoff" },
      "send",
      "fix it there",
    );
    expect(onSaveAndSend).not.toHaveBeenCalled();
    expect(textarea()).toBeNull();
  });
});

describe("citation comment popup position", () => {
  it("stays on screen when the cited text ends in a code block's hidden overflow", async () => {
    using _source = setup();
    const message = document.createElement("div");
    message.className = "chat-markdown";
    message.style.width = "240px";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    // Highlighted code is split into token spans, so the range's last client rect
    // covers only the final token, wholly inside the hidden overflow.
    for (let index = 0; index < 40; index += 1) {
      const token = document.createElement("span");
      token.textContent = `token${index} `;
      code.append(token);
    }
    pre.append(code);
    message.append(pre);
    document.body.prepend(message);
    using _message = { [Symbol.dispose]: () => message.remove() };
    const range = document.createRange();
    range.selectNodeContents(code);
    const rects = range.getClientRects();
    expect(rects.item(rects.length - 1)!.left).toBeGreaterThan(window.innerWidth);
    const sourceAnchor = {
      source: message,
      range,
      viewport: document.body,
    } as AssistantCitationSourceAnchor;

    await using _screen = await mount(
      sourceAnchor,
      vi.fn(() => true),
    );
    const popup = () => document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
    await vi.waitFor(() => expect(popup()?.getBoundingClientRect().width).toBeGreaterThan(0));
    // Typing scrolls ancestors to reveal the caret, which shifts the whole app
    // sideways when the box is off screen.
    await userEvent.keyboard("note");

    expect(textarea()?.value).toBe("note");
    expect(document.scrollingElement?.scrollLeft).toBe(0);
    expect(document.body.scrollLeft).toBe(0);
    const rect = popup()!.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  });
});
