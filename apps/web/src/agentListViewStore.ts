import {
  DEFAULT_AGENT_LIST_VIEW,
  type AgentListView,
} from "@t3tools/client-runtime/state/agent-list-view";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** What an agent's detail view lists: its whole transcript, or only its tool calls. */
export type AgentActivityMode = "transcript" | "tools";

/**
 * Fork: the agents list's filter and sort, and the agent detail view's activity
 * mode, remembered on this device. Search text is session-only.
 */
export const useAgentListViewStore = create<{
  view: AgentListView;
  activityMode: AgentActivityMode;
  setView: (view: AgentListView) => void;
  setActivityMode: (mode: AgentActivityMode) => void;
}>()(
  persist(
    (set) => ({
      view: DEFAULT_AGENT_LIST_VIEW,
      activityMode: "transcript",
      setView: (view) => set({ view }),
      setActivityMode: (activityMode) => set({ activityMode }),
    }),
    {
      // The fork's pre-v2 Agents panel key, so a saved filter carries over.
      name: "t3code:agents-panel:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: (state) => ({
        view: { ...state.view, query: DEFAULT_AGENT_LIST_VIEW.query },
        activityMode: state.activityMode,
      }),
    },
  ),
);
