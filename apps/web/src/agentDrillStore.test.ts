import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  popAgentDrill,
  pushAgentDrill,
  selectAgentDrillStack,
  useAgentDrillStore,
} from "./agentDrillStore";

const scout = ThreadId.make("thread-scout");
const helper = ThreadId.make("thread-helper");
const reader = ThreadId.make("thread-reader");

describe("agent drill stack", () => {
  it("drills inward and goes back one level at a time", () => {
    const stack = pushAgentDrill(pushAgentDrill([], scout), helper);
    expect(stack).toEqual([scout, helper]);
    expect(popAgentDrill(stack)).toEqual([scout]);
    expect(popAgentDrill(popAgentDrill(stack))).toEqual([]);
    expect(popAgentDrill([])).toEqual([]);
  });

  it("returns to an agent already on the stack instead of repeating it", () => {
    const stack = [scout, helper, reader];
    expect(pushAgentDrill(stack, helper)).toEqual([scout, helper]);
    expect(pushAgentDrill(stack, reader)).toBe(stack);
  });
});

describe("useAgentDrillStore", () => {
  beforeEach(() => useAgentDrillStore.setState({ stacks: {} }));

  it("keeps each thread's drill-in separate", () => {
    const store = useAgentDrillStore.getState();
    store.push("env:parent-a", scout);
    store.push("env:parent-a", helper);
    store.push("env:parent-b", reader);
    store.back("env:parent-a");
    const state = useAgentDrillStore.getState();
    expect(selectAgentDrillStack("env:parent-a")(state)).toEqual([scout]);
    expect(selectAgentDrillStack("env:parent-b")(state)).toEqual([reader]);
  });

  it("focuses one agent with Back returning to the list", () => {
    const store = useAgentDrillStore.getState();
    store.push("env:parent", scout);
    store.push("env:parent", helper);
    store.focus("env:parent", reader);
    expect(selectAgentDrillStack("env:parent")(useAgentDrillStore.getState())).toEqual([reader]);
    store.back("env:parent");
    expect(useAgentDrillStore.getState().stacks).toEqual({});
  });
});
