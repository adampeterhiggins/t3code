import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useSplitViewStore } from "../../splitViewStore";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../../state/entities";
import { resolveThreadSyncPhase } from "../../threadSync";
import { cn } from "~/lib/utils";
import ChatView from "../ChatView";
import { SplitPaneContext, useSplitViewActions } from "./splitPane";

function SplitPane({
  threadRef,
  focused,
  side,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  focused: boolean;
  side: "start" | "end";
  onFocus: () => void;
}) {
  const shell = useThreadShell(threadRef);
  const detail = useThreadDetail(threadRef);
  const status = useThreadStatus(threadRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: detail !== null,
    shellExists: shell !== null,
    status,
  });
  const context = useMemo(() => ({ focused }), [focused]);
  return (
    <SplitPaneContext.Provider value={context}>
      <div
        data-split-pane={side}
        data-split-pane-focused={focused ? "true" : "false"}
        className={cn(
          // Layout containment keeps each pane's fixed title-bar controls inside the pane and
          // stops one pane's reflow from invalidating the other.
          "relative flex min-h-0 min-w-0 flex-1 basis-0 [contain:layout]",
          side === "start"
            ? // Native window controls sit over the end pane only.
              "[--workspace-controls-right:0.75rem] [--workspace-native-controls-inset:0px]"
            : // The collapsed-sidebar toggle and traffic lights sit over the start pane only.
              "border-s border-border [--workspace-titlebar-content-left:var(--workspace-gutter)]",
        )}
        onPointerDownCapture={focused ? undefined : onFocus}
      >
        {focused ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 bg-primary"
          />
        ) : null}
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          threadSyncPhase={threadSyncPhase}
          reserveTitleBarControlInset={side === "end"}
        />
      </div>
    </SplitPaneContext.Provider>
  );
}

/**
 * Two chat views side by side, in the order the split stores them. Panes are keyed by thread so
 * moving focus between them never remounts either timeline.
 */
export function SplitChatPanes({
  routeRef,
  partnerRef,
}: {
  routeRef: ScopedThreadRef;
  partnerRef: ScopedThreadRef;
}) {
  const { focusPane } = useSplitViewActions();
  const routeKey = scopedThreadKey(routeRef);
  const routeFirst = useSplitViewStore((state) => state.panes?.[0] === routeKey);
  const panes = routeFirst ? [routeRef, partnerRef] : [partnerRef, routeRef];
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {panes.map((ref, index) => (
        <SplitPane
          key={scopedThreadKey(ref)}
          threadRef={ref}
          focused={ref === routeRef}
          side={index === 0 ? "start" : "end"}
          onFocus={() => focusPane(ref)}
        />
      ))}
    </div>
  );
}
