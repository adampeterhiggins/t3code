import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import type { TimelineEntry } from "../../session-logic";
import { render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const at = "2026-10-22T09:00:00Z";
const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

function assistant(id: string, text: string): TimelineEntry {
  return {
    kind: "message",
    id,
    createdAt: at,
    message: {
      id: MessageId.make(id),
      role: "assistant",
      text,
      runId: null,
      streaming: false,
      createdAt: at,
      updatedAt: at,
    },
  };
}

function tool(id: string, label: string): TimelineEntry {
  return {
    kind: "work",
    id,
    createdAt: at,
    entry: { id, createdAt: at, label, tone: "tool", itemType: "web_search" },
  };
}

const entries = [
  assistant("first", "First answer here."),
  tool("search-1", "Searched once"),
  tool("search-2", "Searched twice"),
  assistant("second", "Second answer here."),
];

/** The timeline's row markup, reduced to what citation capture reads. */
function Timeline({
  onCite,
  onToolClick,
}: {
  onCite: (citation: AssistantCitation) => boolean;
  onToolClick: () => void;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const message = (id: string, text: string) => (
    <div data-timeline-row-id={`row-${id}`} data-timeline-row-kind="message" data-message-id={id}>
      <div data-assistant-citation-source={id}>
        <p>{text}</p>
      </div>
    </div>
  );
  const toolRow = (id: string, label: string) => (
    <div data-work-entry-id={id}>
      <div role="button" tabIndex={0} className="select-none" onClick={onToolClick}>
        {label}
      </div>
    </div>
  );
  return (
    <div ref={setViewport} data-assistant-citation-viewport="true" className="relative h-96 p-4">
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={threadRef}
        entries={entries}
        workspaceRoot={undefined}
        actionBottom={12}
        onCite={onCite}
      />
      {message("first", "First answer here.")}
      <div data-timeline-row-id="row-tools" data-timeline-row-kind="work">
        {toolRow("search-1", "Searched once")}
        {toolRow("search-2", "Searched twice")}
      </div>
      {message("second", "Second answer here.")}
    </div>
  );
}

function textNode(text: string): Text {
  const element = [...document.querySelectorAll("p")].find((node) => node.textContent === text);
  return element!.firstChild as Text;
}

describe("AssistantSelectionToolbar transcript excerpts", () => {
  it("cites a selection across responses with the tool calls between them", async () => {
    const onCite = vi.fn(() => true);
    await using _screen = await render(<Timeline onCite={onCite} onToolClick={vi.fn()} />);

    window
      .getSelection()!
      .setBaseAndExtent(textNode("First answer here."), 6, textNode("Second answer here."), 6);
    await userEvent.click(page.getByRole("button", { name: "Cite selection in composer" }));

    const [citation] = onCite.mock.calls[0] as unknown as [AssistantCitation];
    expect(citation.segments).toStrictEqual([
      { kind: "assistant", id: "first" },
      { kind: "tool", id: "search-1" },
      { kind: "tool", id: "search-2" },
      { kind: "assistant", id: "second" },
    ]);
    expect(citation.text).toMatch(/^Assistant:\nanswer here\.\n\n/);
    expect(citation.text).toMatch(/\n\nAssistant:\nSecond$/);
  });

  it("shift-click picks tool calls instead of toggling them, and grows a text selection", async () => {
    const onCite = vi.fn(() => true);
    const onToolClick = vi.fn();
    await using screen = await render(<Timeline onCite={onCite} onToolClick={onToolClick} />);

    window
      .getSelection()!
      .setBaseAndExtent(textNode("First answer here."), 6, textNode("First answer here."), 12);
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(screen.getByText("Searched twice"));
    await userEvent.keyboard("{/Shift}");

    expect(onToolClick).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Cite 1 message, 2 tool calls in composer" }),
    );
    const [citation] = onCite.mock.calls[0] as unknown as [AssistantCitation];
    expect(citation.segments?.map((segment) => segment.id)).toStrictEqual([
      "first",
      "search-1",
      "search-2",
    ]);
    // The excerpt runs from the selection's start to the end of its response.
    expect(citation.text).toMatch(/^Assistant:\nanswer here\.\n\n/);
    await expect
      .element(screen.getByRole("button", { name: /^Cite 1 message/ }))
      .not.toBeInTheDocument();
  });

  it("shift-click on one tool call cites it alone, and Escape clears the pick", async () => {
    const onCite = vi.fn(() => true);
    await using screen = await render(<Timeline onCite={onCite} onToolClick={vi.fn()} />);

    await userEvent.keyboard("{Shift>}");
    await userEvent.click(screen.getByText("Searched once"));
    await userEvent.keyboard("{/Shift}");
    const pill = screen.getByRole("button", { name: "Cite Tool call: Searched once in composer" });
    await expect.element(pill).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(pill).not.toBeInTheDocument();
    expect(onCite).not.toHaveBeenCalled();
  });
});
