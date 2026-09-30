/**
 * The sidebar's attention inbox: a header button that appears while any
 * thread needs the user, and a popover listing those threads across every
 * project, environment and tab group. Opening an entry lands on that exact
 * chat tab. Failures and completions can be marked read here; the thread
 * menu's Mark unread brings a completion back.
 */
import type { ThreadAttentionReason } from "@t3tools/client-runtime/state/attention-inbox";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InboxIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useAttentionInbox, type WebAttentionInboxEntry } from "../../hooks/useAttentionInbox";
import { useProjects } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { useUiStateStore } from "../../uiStateStore";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { useSidebar } from "../ui/sidebar";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

export const ATTENTION_REASON_PRESENTATION: Record<
  ThreadAttentionReason,
  { readonly label: string; readonly Icon: LucideIcon; readonly iconClassName: string }
> = {
  approval: {
    label: "Approval needed",
    Icon: ShieldQuestionIcon,
    iconClassName: "text-warning-foreground",
  },
  input: {
    label: "Input needed",
    Icon: MessageCircleQuestionIcon,
    iconClassName: "text-info-foreground",
  },
  failed: { label: "Failed", Icon: CircleAlertIcon, iconClassName: "text-destructive-foreground" },
  completed: {
    label: "Completed",
    Icon: CircleCheckIcon,
    iconClassName: "text-success-foreground",
  },
};

/** Project titles keyed like thread shells, for the entries' second line. */
export function useProjectTitleByKey(): ReadonlyMap<string, string> {
  const projects = useProjects();
  return useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );
}

export function SidebarAttentionInbox() {
  const entries = useAttentionInbox();
  const [open, setOpen] = useState(false);
  if (entries.length === 0 && !open) return null;
  const label = `Needs attention (${entries.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<SidebarHeaderIconButton label={label} />}>
        <InboxIcon />
        {entries.length > 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-primary px-1 text-center text-3xs font-medium leading-3.5 text-primary-foreground tabular-nums"
          >
            {entries.length > 99 ? "99+" : entries.length}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup align="start" width="md" padding="compact" aria-label="Needs attention">
        <AttentionInboxList entries={entries} onOpenEntry={() => setOpen(false)} />
      </PopoverPopup>
    </Popover>
  );
}

function AttentionInboxList(props: {
  entries: ReadonlyArray<WebAttentionInboxEntry>;
  onOpenEntry: () => void;
}) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const projectTitleByKey = useProjectTitleByKey();

  return (
    <div className="flex flex-col gap-1">
      <PopoverTitle className="m-1">Needs attention</PopoverTitle>
      {props.entries.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">Nothing needs you right now.</p>
      ) : (
        <ul className="-mx-1 flex max-h-96 flex-col overflow-y-auto">
          {props.entries.map((entry) => {
            const { label, Icon, iconClassName } = ATTENTION_REASON_PRESENTATION[entry.reason];
            const projectTitle = projectTitleByKey.get(
              `${entry.thread.environmentId}:${entry.thread.projectId}`,
            );
            const canMarkRead = entry.reason === "failed" || entry.reason === "completed";
            return (
              <li
                key={entry.key}
                className="group flex items-center gap-1 rounded-md hover:bg-accent"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    props.onOpenEntry();
                    if (isMobile) setOpenMobile(false);
                    // The entry's own route, not its tab group's last-opened tab.
                    void router.navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(
                        scopeThreadRef(entry.thread.environmentId, entry.thread.id),
                      ),
                    });
                  }}
                >
                  <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", iconClassName)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">{entry.thread.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {projectTitle ? `${label} · ${projectTitle}` : label}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRelativeTimeLabel(entry.at)}
                  </span>
                </button>
                {canMarkRead ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    className="mr-1 shrink-0"
                    aria-label={`Mark ${entry.thread.title} as read`}
                    title="Mark as read"
                    onClick={() => markThreadVisited(entry.key, new Date().toISOString())}
                  >
                    <CheckIcon />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
