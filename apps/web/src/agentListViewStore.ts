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
 * Fork: the agents list's filter and sort, whether its rows show their second line (latest tool
 * call, result, or error), and the agent detail view's activity mode, remembered on this device.
 * Search text is session-only.
 */
export const useAgentListViewStore = create<{
  view: AgentListView;
  activityMode: AgentActivityMode;
  showRowDetails: boolean;
  setView: (view: AgentListView) => void;
  setActivityMode: (mode: AgentActivityMode) => void;
  setShowRowDetails: (show: boolean) => void;
}>()(
  persist(
    (set) => ({
      view: DEFAULT_AGENT_LIST_VIEW,
      activityMode: "tools",
      showRowDetails: true,
      setView: (view) => set({ view }),
      setActivityMode: (activityMode) => set({ activityMode }),
      setShowRowDetails: (showRowDetails) => set({ showRowDetails }),
    }),
    {
      // The fork's pre-v2 Agents panel key, so a saved filter carries over.
      name: "t3code:agents-panel:v1",
      // Version 1 makes Tools the default once, replacing the "transcript" every device saved.
      version: 1,
      migrate: (persisted) => ({
        ...(persisted as { view: AgentListView }),
        activityMode: "tools" as AgentActivityMode,
      }),
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: (state) => ({
        view: { ...state.view, query: DEFAULT_AGENT_LIST_VIEW.query },
        activityMode: state.activityMode,
        showRowDetails: state.showRowDetails,
      }),
    },
  ),
);
