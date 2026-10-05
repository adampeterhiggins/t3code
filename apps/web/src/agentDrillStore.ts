import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Fork: which agent the Agents panel has drilled into, per thread. The stack
 * holds child thread ids from the fleet list inward: an agent, then an agent it
 * spawned, and so on. Empty shows the fleet list. Session-only, so it survives
 * switching right-panel tabs but resets on reload.
 */
export type AgentDrillStack = ReadonlyArray<ThreadId>;

const EMPTY_STACK: AgentDrillStack = Object.freeze([]);

/** Drills into `childThreadId`. An agent already on the stack is returned to, never repeated. */
export function pushAgentDrill(stack: AgentDrillStack, childThreadId: ThreadId): AgentDrillStack {
  const index = stack.indexOf(childThreadId);
  if (index !== -1) return index === stack.length - 1 ? stack : stack.slice(0, index + 1);
  return [...stack, childThreadId];
}

/** Goes back one level; the fleet list once the stack is empty. */
export function popAgentDrill(stack: AgentDrillStack): AgentDrillStack {
  return stack.length === 0 ? stack : stack.slice(0, -1);
}

export const useAgentDrillStore = create<{
  stacks: Readonly<Record<string, AgentDrillStack>>;
  push: (threadKey: string, childThreadId: ThreadId) => void;
  back: (threadKey: string) => void;
  /** Opens the panel's detail straight onto one agent, with Back returning to the list. */
  focus: (threadKey: string, childThreadId: ThreadId) => void;
  /** Back to the fleet list. */
  reset: (threadKey: string) => void;
}>()((set) => {
  const update = (threadKey: string, next: (stack: AgentDrillStack) => AgentDrillStack) =>
    set((state) => {
      const current = state.stacks[threadKey] ?? EMPTY_STACK;
      const stack = next(current);
      if (stack === current) return state;
      const { [threadKey]: _previous, ...rest } = state.stacks;
      return { stacks: stack.length === 0 ? rest : { ...rest, [threadKey]: stack } };
    });
  return {
    stacks: {},
    push: (threadKey, childThreadId) =>
      update(threadKey, (stack) => pushAgentDrill(stack, childThreadId)),
    back: (threadKey) => update(threadKey, popAgentDrill),
    focus: (threadKey, childThreadId) => update(threadKey, () => [childThreadId]),
    reset: (threadKey) => update(threadKey, () => EMPTY_STACK),
  };
});

export function selectAgentDrillStack(threadKey: string) {
  return (state: { stacks: Readonly<Record<string, AgentDrillStack>> }): AgentDrillStack =>
    state.stacks[threadKey] ?? EMPTY_STACK;
}
