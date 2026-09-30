import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";

import type { resolveSidebarThreadStatus } from "../Sidebar.logic";

export type SidebarTopStatus = {
  label: string;
  icon: "working" | "monitoring" | "approval" | "input" | "failed" | "woke" | "done";
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
      return { label: "Working", icon: "working", className: "text-sky-600 dark:text-sky-400" };
    case "monitoring":
      // Monitoring is calm background presence, not active progress
      // (monitoring-pill D6), so it keeps the label at full strength.
      return {
        label: "Monitoring",
        icon: "monitoring",
        className: "text-foreground dark:text-white",
      };
    case "approval":
      return { label: "Approval", icon: "approval", className: "text-warning-foreground" };
    case "input":
      return {
        label: "Input",
        icon: "input",
        className: "text-indigo-600 dark:text-indigo-300",
      };
    case "failed":
      return { label: "Failed", icon: "failed", className: "text-red-700 dark:text-red-300" };
  }
  if (isWoke) return { label: "Woke", icon: "woke", className: "text-warning-foreground" };
  if (isUnread) {
    return { label: "Done", icon: "done", className: "text-emerald-700 dark:text-emerald-300" };
  }
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
    case "monitoring":
      return <EyeIcon aria-hidden className={props.className} />;
    case "done":
      return <CircleCheckIcon aria-hidden className={props.className} />;
    case "woke":
      return <AlarmClockIcon aria-hidden className={props.className} />;
  }
}
