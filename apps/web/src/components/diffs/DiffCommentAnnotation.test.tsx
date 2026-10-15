import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DiffCommentAnnotation } from "./DiffCommentAnnotation";

const callbacks = {
  onTextChange: vi.fn(),
  onCancel: vi.fn(),
  onComment: vi.fn(),
  onDelete: vi.fn(),
};

describe("DiffCommentAnnotation", () => {
  it("renders the shared draft composer directly in the selected diff", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentAnnotation kind="draft" rangeLabel="+78" text="" {...callbacks} />,
    );

    expect(markup).toContain("font-sans");
    expect(markup).not.toContain("chat-composer-glass");
    expect(markup).not.toContain("font-mono");
    expect(markup).not.toContain("Local comment");
    expect(markup).not.toContain("on +78");
    expect(markup).toContain("⌘/Ctrl Enter to send");
    expect(markup).toContain("Add a comment…");
    expect(markup).toContain(">Comment</button>");
    expect(markup).toContain("autofocus");
    // The comment box is the standard small Textarea, not a bespoke surface.
    expect(markup).toMatch(/<span[^>]*data-size="sm"[^>]*data-slot="textarea-control"/);
  });

  it("offers the agent beside the review, as the last way the reader handed one over", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentAnnotation
        kind="draft"
        rangeLabel="src/app.ts:4"
        text=""
        {...callbacks}
        submitLabel="Add to review"
        agentAction={{ send: vi.fn(), addToComposer: vi.fn() }}
      />,
    );

    expect(markup).toContain("Add a comment…");
    expect(markup).toContain("with Shift for agent");
    expect(markup.match(/<button[^>]*disabled[^>]*>Add to review<\/button>/)).not.toBeNull();
    expect(markup.match(/<button[^>]*disabled[^>]*>Send to agent<\/button>/)).not.toBeNull();
  });

  it("renders a saved comment without a nested card or redundant range label", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentAnnotation
        kind="comment"
        rangeLabel="+78"
        text="Please keep this branch explicit."
        {...callbacks}
      />,
    );

    expect(markup).toContain("font-sans");
    expect(markup).not.toContain("chat-composer-glass");
    expect(markup).not.toContain("on +78");
    expect(markup).toContain("Please keep this branch explicit.");
    expect(markup).toContain('aria-label="Delete comment"');
    expect(markup).toContain("border-s-2");
    expect(markup).toContain("bg-primary/[0.045]");
    expect(markup).toContain("lucide-message-circle");
  });

  it("renders draft text owned by the annotation wrapper", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentAnnotation
        kind="draft"
        rangeLabel="+78"
        text="Keep this unsaved draft"
        {...callbacks}
      />,
    );

    expect(markup).toContain("Keep this unsaved draft");
  });
});
