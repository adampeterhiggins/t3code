import {
  DEFAULT_AGENT_PANEL_VIEW,
  type AgentPanelView,
} from "@t3tools/client-runtime/state/agentPanelView";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/**
 * Agents-panel presentation state. The filter/sort view is remembered on this
 * device (search text is not); the focused agent is per thread and session-only,
 * so the chat can open the panel straight onto one agent. A focus can carry a
 * tool call to open expanded (clicking a call in an agent's hover preview).
 */
export const useAgentsPanelStore = create<{
  view: AgentPanelView;
  focusedAgentIdByThreadKey: Readonly<Record<string, string>>;
  focusedToolCallId: string | null;
  setView: (view: AgentPanelView) => void;
  focusAgent: (threadKey: string, agentId: string | null, toolCallId?: string | null) => void;
}>()(
  persist(
    (set) => ({
      view: DEFAULT_AGENT_PANEL_VIEW,
      focusedAgentIdByThreadKey: {},
      focusedToolCallId: null,
      setView: (view) => set({ view }),
      focusAgent: (threadKey, agentId, toolCallId = null) =>
        set((state) => {
          const { [threadKey]: _previous, ...rest } = state.focusedAgentIdByThreadKey;
          return {
            focusedAgentIdByThreadKey: agentId ? { ...rest, [threadKey]: agentId } : rest,
            focusedToolCallId: agentId ? toolCallId : null,
          };
        }),
    }),
    {
      name: "t3code:agents-panel:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: (state) => ({
        view: { ...state.view, query: DEFAULT_AGENT_PANEL_VIEW.query },
      }),
    },
  ),
);
