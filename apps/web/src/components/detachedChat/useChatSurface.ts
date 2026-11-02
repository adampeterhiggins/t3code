import { useDetachedChatPresentation } from "../quickMessage/detachedChatPresentation";
import { isDetachedChatWindow } from "../quickMessage/quickMessageWindow";

/**
 * What ChatView shows in this window. The floating chat leaves the workspace (right panel,
 * attachment previews, terminal, diffs, preview) to the main window, and its compact
 * presentation is only the composer.
 */
export function useChatSurface(embedded: boolean) {
  const compact = useDetachedChatPresentation() === "compact";
  const workspace = !isDetachedChatWindow;
  return {
    workspace,
    /** Window-level hosts a side chat also leaves out: device setup, preview sync, mini player. */
    windowChrome: workspace && !embedded,
    header: !embedded && !compact,
    compact,
  };
}
