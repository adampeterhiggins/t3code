import { describe, expect, it } from "vite-plus/test";

import { objectLinkChipDestination, objectLinkChipEdit } from "./composerObjectLinkChip";

const reference = { kind: "linear-issue", contextId: "linear:ENG-1", label: "ENG-1" } as const;
const url = "https://linear.app/acme/issue/ENG-1/fix-it";

describe("objectLinkChipDestination", () => {
  const prompt = { draftKey: "thread-a", workKey: "thread-a" };
  const answer = { draftKey: "thread-a", workKey: "question-1" };

  it("edits on screen while the pasted text is still showing", () => {
    expect(objectLinkChipDestination(prompt, prompt)).toBe("editor");
    expect(objectLinkChipDestination(answer, answer)).toBe("editor");
  });

  it("writes a composer paste into its stored draft once another draft is showing", () => {
    expect(objectLinkChipDestination(prompt, { draftKey: "thread-b", workKey: "thread-b" })).toBe(
      "stored-draft",
    );
    expect(objectLinkChipDestination(prompt, answer)).toBe("stored-draft");
    expect(objectLinkChipDestination(prompt, null)).toBe("stored-draft");
  });

  it("drops an answer paste once its question has closed", () => {
    expect(objectLinkChipDestination(answer, prompt)).toBe("drop");
    expect(objectLinkChipDestination(answer, null)).toBe("drop");
  });
});

describe("objectLinkChipEdit", () => {
  it("swaps the link for the chip, keeping the text around it", () => {
    const prompt = `see ${url} please`;
    const edit = objectLinkChipEdit(prompt, url, 4, reference);
    expect(edit).not.toBeNull();
    const next = `${prompt.slice(0, edit!.start)}${edit!.text}${prompt.slice(edit!.end)}`;
    expect(next.startsWith("see ")).toBe(true);
    expect(next.endsWith(" please")).toBe(true);
    expect(next).not.toContain(url);
  });

  it("finds the link after text was typed before it", () => {
    expect(objectLinkChipEdit(`more words, see ${url}`, url, 4, reference)).not.toBeNull();
  });

  it("is null once the link was edited away", () => {
    expect(objectLinkChipEdit("see", url, 4, reference)).toBeNull();
    expect(objectLinkChipEdit(`see ${url}/longer`, url, 4, reference)).toBeNull();
  });
});
