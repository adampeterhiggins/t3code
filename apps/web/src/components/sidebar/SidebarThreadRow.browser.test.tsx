import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TooltipProvider } from "../ui/tooltip";
import { SidebarSearchResultRow } from "./SidebarThreadRow";

const environmentId = EnvironmentId.make("search-menu-env");
const threadId = ThreadId.make("search-menu-thread");
const threadRef = scopeThreadRef(environmentId, threadId);

function searchResult(
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void,
) {
  const thread = {
    id: threadId,
    environmentId,
    title: "Reconcile Party Guest RSVPs",
    createdAt: "2026-11-07T09:00:00.000Z",
    updatedAt: "2026-11-07T09:00:00.000Z",
  } as EnvironmentThreadShell;
  return (
    <TooltipProvider>
      <ul>
        <SidebarSearchResultRow
          isSettled={false}
          thread={thread}
          project={null}
          projectDisplayName={null}
          isHighlighted={false}
          isRouteActive={false}
          resultId="sidebar-thread-search-result-0"
          searchMatch={null}
          searchQuery="recon"
          onHighlight={vi.fn()}
          onSelect={vi.fn()}
          onContextMenu={onContextMenu}
          onFileDropThreads={vi.fn()}
        />
      </ul>
    </TooltipProvider>
  );
}

it("opens the thread menu from a search result instead of the browser menu", async () => {
  const onContextMenu =
    vi.fn<(threadRef: ScopedThreadRef, position: { x: number; y: number }) => void>();
  // The row reports the menu; the sidebar owns navigation.
  await using screen = await render(searchResult(onContextMenu), { router: false });
  const row = screen.getByRole("option", { name: "Reconcile Party Guest RSVPs" });
  const title = row.element().querySelector("span");
  if (title === null) throw new Error("Search result title is missing");

  const contextMenu = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 80,
  });
  title.dispatchEvent(contextMenu);

  expect(contextMenu.defaultPrevented).toBe(true);
  expect(onContextMenu).toHaveBeenCalledWith(threadRef, { x: 40, y: 80 });

  row.element().focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  const rect = row.element().getBoundingClientRect();
  expect(onContextMenu).toHaveBeenLastCalledWith(threadRef, { x: rect.left, y: rect.bottom });
});
