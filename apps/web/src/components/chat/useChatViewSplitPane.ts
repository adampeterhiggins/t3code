import { useSplitPaneFocus } from "./splitPane";
import { useLayoutEffect, useRef } from "react";

export function useChatViewSplitPane() {
  // In a split, the pane beside the routed chat leaves window-level shortcuts and focus alone.
  const splitPaneFocus = useSplitPaneFocus();
  const unfocusedSplitPane = splitPaneFocus === "unfocused";
  const unfocusedSplitPaneRef = useRef(unfocusedSplitPane);
  useLayoutEffect(() => {
    unfocusedSplitPaneRef.current = unfocusedSplitPane;
  }, [unfocusedSplitPane]);
  return { splitPaneFocus, unfocusedSplitPane, unfocusedSplitPaneRef };
}
