import {
  DEFAULT_AGENT_LIST_VIEW,
  type AgentListView,
} from "@t3tools/client-runtime/state/agent-list-view";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/**
 * Fork: the agents list's filter and sort, remembered on this device. Search
 * text is session-only.
 */
export const useAgentListViewStore = create<{
  view: AgentListView;
  setView: (view: AgentListView) => void;
}>()(
  persist(
    (set) => ({
      view: DEFAULT_AGENT_LIST_VIEW,
      setView: (view) => set({ view }),
    }),
    {
      // The fork's pre-v2 Agents panel key, so a saved filter carries over.
      name: "t3code:agents-panel:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: (state) => ({
        view: { ...state.view, query: DEFAULT_AGENT_LIST_VIEW.query },
      }),
    },
  ),
);
