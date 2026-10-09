import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  assignSubagentHandles,
  matchesSubagentQuery,
  subagentContextId,
  subagentHandlesFromShells,
  subagentHandleSlug,
} from "./subagentHandles.ts";

const parent = ThreadId.make("thread-parent");
const child = ThreadId.make("thread-child");

describe("subagentHandleSlug", () => {
  it("slugs a title into lowercase words", () => {
    expect(subagentHandleSlug("Explore the auth flow!")).toBe("explore-the-auth-flow");
    expect(subagentHandleSlug("Café résumé")).toBe("cafe-resume");
  });

  it("cuts long titles at a word", () => {
    expect(subagentHandleSlug("Review the database migration scripts for production safety")).toBe(
      "review-the-database-migration",
    );
  });

  it("falls back when nothing survives", () => {
    expect(subagentHandleSlug("!!!")).toBe("agent");
    expect(subagentHandleSlug("")).toBe("agent");
  });
});

describe("assignSubagentHandles", () => {
  it("numbers agents of one owner whose titles slug alike, in spawn order", () => {
    const handles = assignSubagentHandles([
      { key: "b", ownerThreadId: parent, title: "Explore", spawnedAt: "2026-10-09T10:01:00Z" },
      { key: "a", ownerThreadId: parent, title: "explore", spawnedAt: "2026-10-09T10:00:00Z" },
      { key: "c", ownerThreadId: parent, title: "Explore", spawnedAt: null },
    ]);
    expect(handles.get("a")).toBe("explore");
    expect(handles.get("b")).toBe("explore-2");
    expect(handles.get("c")).toBe("explore-3");
  });

  it("lets agents of different owners share a handle", () => {
    const handles = assignSubagentHandles([
      { key: "a", ownerThreadId: parent, title: "Explore", spawnedAt: "2026-10-09T10:00:00Z" },
      { key: "b", ownerThreadId: child, title: "Explore", spawnedAt: "2026-10-09T10:01:00Z" },
    ]);
    expect(handles.get("a")).toBe("explore");
    expect(handles.get("b")).toBe("explore");
  });

  it("skips a suffix another agent's title already took", () => {
    const handles = assignSubagentHandles([
      { key: "a", ownerThreadId: parent, title: "Explore 2", spawnedAt: "2026-10-09T10:00:00Z" },
      { key: "b", ownerThreadId: parent, title: "Explore", spawnedAt: "2026-10-09T10:01:00Z" },
      { key: "c", ownerThreadId: parent, title: "Explore", spawnedAt: "2026-10-09T10:02:00Z" },
    ]);
    expect(handles.get("a")).toBe("explore-2");
    expect(handles.get("b")).toBe("explore");
    expect(handles.get("c")).toBe("explore-3");
  });
});

describe("matchesSubagentQuery", () => {
  const subject = { handle: "explore-auth-flow", title: "Explore the auth flow" };

  it("matches part of the handle or words of the title", () => {
    expect(matchesSubagentQuery(subject, "")).toBe(true);
    expect(matchesSubagentQuery(subject, "auth-fl")).toBe(true);
    expect(matchesSubagentQuery(subject, "the flow")).toBe(true);
    expect(matchesSubagentQuery(subject, "review")).toBe(false);
  });
});

describe("subagentHandlesFromShells", () => {
  const shell = (
    id: string,
    title: string,
    createdAt: string,
    lineage: { parentThreadId: ThreadId | null; relationshipToParent: "subagent" | "fork" | null },
  ) => ({
    id: ThreadId.make(id),
    title,
    createdAt: DateTime.makeUnsafe(createdAt),
    lineage,
  });

  it("names only the owner's subagent threads, numbering alike titles by creation", () => {
    const handles = subagentHandlesFromShells(parent, [
      shell("b", "Subagent: Explore", "2026-10-09T10:01:00Z", {
        parentThreadId: parent,
        relationshipToParent: "subagent",
      }),
      shell("a", "Explore", "2026-10-09T10:00:00Z", {
        parentThreadId: parent,
        relationshipToParent: "subagent",
      }),
      shell("fork", "Explore", "2026-10-09T09:00:00Z", {
        parentThreadId: parent,
        relationshipToParent: "fork",
      }),
      shell("nested", "Explore", "2026-10-09T09:00:00Z", {
        parentThreadId: child,
        relationshipToParent: "subagent",
      }),
    ]);
    expect([...handles]).toEqual([
      ["a", "explore"],
      ["b", "explore-2"],
    ]);
  });
});

describe("subagentContextId", () => {
  it("keeps long ids that share a prefix apart, within the context id grammar", () => {
    const prefix = `thread:provider:claudeAgent:native-thread:${"x".repeat(160)}`;
    const first = subagentContextId(`${prefix}:a2b239651da4818a1`);
    const second = subagentContextId(`${prefix}:adc5f1a959979a0d2`);
    expect(first).not.toBe(second);
    for (const id of [first, second]) {
      expect(id).toMatch(/^[a-z0-9_-]{1,128}$/i);
    }
  });
});
