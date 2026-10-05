import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";

import type { resolveSidebarThreadStatus } from "../Sidebar.logic";

export type SidebarTopStatus = {
  label: string;
  /** Null for calm statuses that carry only a label. */
  icon: "working" | "approval" | "input" | "failed" | "woke" | "done" | null;
  className: string;
};

// Status hues follow the system-wide convention set by sidebar v1 and the
// mobile Live Activity/widgets (amber approval, indigo input, sky working)
// so a thread reads the same color everywhere it surfaces.
export function resolveSidebarTopStatus(
  status: ReturnType<typeof resolveSidebarThreadStatus>,
  isWoke: boolean,
  isUnread: boolean,
): SidebarTopStatus | null {
  switch (status) {
    case "working":
      // No shimmer: a label that animates forever is noise in a sidebar
      // full of them (and repaints every vsync on high-refresh displays).
      return { label: "Working", icon: "working", className: "text-info" };
    case "waiting":
      // Waiting is calm background presence (post-settle background
      // roster), not active progress, so the label keeps full strength.
      return { label: "Waiting", icon: null, className: "text-muted-foreground" };
    case "approval":
      return { label: "Approval", icon: "approval", className: "text-warning-foreground" };
    case "input":
      return {
        label: "Input",
        icon: "input",
        className: "text-indigo-600 dark:text-indigo-300",
      };
    case "limited":
      return { label: "Limited", icon: "failed", className: "text-warning" };
    case "failed":
      return { label: "Failed", icon: "failed", className: "text-error" };
  }
  if (isWoke) return { label: "Woke", icon: "woke", className: "text-warning" };
  if (isUnread) return { label: "Done", icon: "done", className: "text-success" };
  return null;
}

export function SidebarTopStatusIcon(props: { icon: SidebarTopStatus["icon"]; className: string }) {
  switch (props.icon) {
    case "working":
      return <CircleDashedIcon aria-hidden className={props.className} />;
    case "input":
      return <MessageCircleQuestionIcon aria-hidden className={props.className} />;
    case "approval":
      return <ShieldQuestionIcon aria-hidden className={props.className} />;
    case "failed":
      return <CircleAlertIcon aria-hidden className={props.className} />;
    case "done":
      return <CircleCheckIcon aria-hidden className={props.className} />;
    case "woke":
      return <AlarmClockIcon aria-hidden className={props.className} />;
    case null:
      return null;
  }
}
