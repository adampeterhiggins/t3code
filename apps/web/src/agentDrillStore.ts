import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Fork: which agent the Agents panel has drilled into, per thread. The stack
 * holds fleet entry keys (`AgentFleetEntry.key`) from the fleet list inward:
 * an agent, then an agent it spawned, and so on. A key is the agent's child
 * thread id, or `subagent:<id>` for an agent recorded before its thread exists.
 * Empty shows the fleet list. Session-only, so it survives switching right-panel
 * tabs but resets on reload.
 */
export type AgentDrillStack = ReadonlyArray<string>;

const EMPTY_STACK: AgentDrillStack = Object.freeze([]);

/** Drills into `key`. An agent already on the stack is returned to, never repeated. */
export function pushAgentDrill(stack: AgentDrillStack, key: string): AgentDrillStack {
  const index = stack.indexOf(key);
  if (index !== -1) return index === stack.length - 1 ? stack : stack.slice(0, index + 1);
  return [...stack, key];
}

/** Goes back one level; the fleet list once the stack is empty. */
export function popAgentDrill(stack: AgentDrillStack): AgentDrillStack {
  return stack.length === 0 ? stack : stack.slice(0, -1);
}

/** A tool call an agent's detail opens on: expanded and scrolled into view. */
export interface AgentToolCallFocus {
  readonly childThreadId: ThreadId;
  readonly itemId: TurnItemId;
}

export const useAgentDrillStore = create<{
  stacks: Readonly<Record<string, AgentDrillStack>>;
  /** Consumed by the next detail view of that agent (`takeToolCall`). */
  toolCall: AgentToolCallFocus | null;
  push: (threadKey: string, key: string) => void;
  back: (threadKey: string) => void;
  /** Opens the panel's detail straight onto one agent, with Back returning to the list. */
  focus: (threadKey: string, key: string) => void;
  /** Back to the fleet list. */
  reset: (threadKey: string) => void;
  /** Asks the agent's next detail view to open on one of its tool calls. */
  focusToolCall: (focus: AgentToolCallFocus) => void;
  /** The pending tool call for `childThreadId`, cleared once read. */
  takeToolCall: (childThreadId: ThreadId) => TurnItemId | null;
}>()((set, get) => {
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
    toolCall: null,
    push: (threadKey, key) => update(threadKey, (stack) => pushAgentDrill(stack, key)),
    back: (threadKey) => update(threadKey, popAgentDrill),
    focus: (threadKey, key) => update(threadKey, () => [key]),
    reset: (threadKey) => update(threadKey, () => EMPTY_STACK),
    focusToolCall: (toolCall) => set({ toolCall }),
    takeToolCall: (childThreadId) => {
      const pending = get().toolCall;
      if (pending?.childThreadId !== childThreadId) return null;
      set({ toolCall: null });
      return pending.itemId;
    },
  };
});

export function selectAgentDrillStack(threadKey: string) {
  return (state: { stacks: Readonly<Record<string, AgentDrillStack>> }): AgentDrillStack =>
    state.stacks[threadKey] ?? EMPTY_STACK;
}
