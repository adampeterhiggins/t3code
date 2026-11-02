import type { ComponentProps, ComponentType } from "react";

import { ChatRightPanel as ChatRightPanelView } from "../chat/ChatRightPanel";
import { ChatTerminalDrawers as ChatTerminalDrawersView } from "../chat/ChatTerminalDrawers";
import {
  PanelLayoutControls as PanelLayoutControlsView,
  ThreadPanelHeaderControl as ThreadPanelHeaderControlView,
  WorkspaceTitlebarControls as WorkspaceTitlebarControlsView,
} from "../chat/PanelLayoutControls";
import { ThreadDetailsPanel as ThreadDetailsPanelView } from "../chat/ThreadDetailsPanel";
import { isDetachedChatWindow } from "../quickMessage/quickMessageWindow";

function renderNothing() {
  return null;
}

/**
 * Workspace surfaces the floating chat leaves to the main window. ChatView imports them from
 * here, so its JSX stays upstream's and the floating window renders nothing in their place.
 */
function mainWindowOnly<P>(Component: ComponentType<P>): ComponentType<P> {
  return isDetachedChatWindow ? renderNothing : Component;
}

export const ChatRightPanel: ComponentType<ComponentProps<typeof ChatRightPanelView>> =
  mainWindowOnly(ChatRightPanelView);
export const ChatTerminalDrawers: ComponentType<ComponentProps<typeof ChatTerminalDrawersView>> =
  mainWindowOnly(ChatTerminalDrawersView);
export const PanelLayoutControls: ComponentType<ComponentProps<typeof PanelLayoutControlsView>> =
  mainWindowOnly(PanelLayoutControlsView);
export const ThreadPanelHeaderControl: ComponentType<
  ComponentProps<typeof ThreadPanelHeaderControlView>
> = mainWindowOnly(ThreadPanelHeaderControlView);
export const WorkspaceTitlebarControls: ComponentType<
  ComponentProps<typeof WorkspaceTitlebarControlsView>
> = mainWindowOnly(WorkspaceTitlebarControlsView);
export const ThreadDetailsPanel: ComponentType<ComponentProps<typeof ThreadDetailsPanelView>> =
  mainWindowOnly(ThreadDetailsPanelView);
