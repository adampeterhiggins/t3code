import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ThreadTabGroup } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { useRightPanelFollowsTabSwitch } from "./ThreadTabs";

const environmentId = EnvironmentId.make("local");
const first = ThreadId.make("first");
const second = ThreadId.make("second");
const unrelated = ThreadId.make("unrelated");
const group = {
  groupId: first,
  tabs: [first, second].map((threadId) => ({ threadId, title: threadId })),
} as unknown as ThreadTabGroup;

let root: Root | null = null;

function Probe(props: { threadId: ThreadId; group: ThreadTabGroup | null }) {
  useRightPanelFollowsTabSwitch(environmentId, props.threadId, props.group);
  return null;
}

function show(threadId: ThreadId, tabGroup: ThreadTabGroup | null) {
  act(() => {
    root ??= createRoot(document.createElement("div"));
    root.render(<Probe threadId={threadId} group={tabGroup} />);
  });
}

const isOpen = (threadId: ThreadId) =>
  selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    scopeThreadRef(environmentId, threadId),
  ).isOpen;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  // Leaving the tab group forgets it, so no switch carries over from a previous test.
  show(unrelated, null);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

it("keeps the right panel open when switching to a sibling tab", () => {
  useRightPanelStore.getState().open(scopeThreadRef(environmentId, first), "diff");
  show(first, group);
  show(second, group);
  expect(isOpen(second)).toBe(true);
});

it("keeps the right panel closed when switching to a sibling tab", () => {
  useRightPanelStore.getState().open(scopeThreadRef(environmentId, second), "diff");
  show(first, group);
  show(second, group);
  expect(isOpen(second)).toBe(false);
});

it("leaves threads outside the tab group alone", () => {
  useRightPanelStore.getState().open(scopeThreadRef(environmentId, first), "diff");
  show(first, group);
  show(unrelated, null);
  expect(isOpen(unrelated)).toBe(false);
});
