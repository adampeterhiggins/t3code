import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";

import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import type { resolveSidebarThreadStatus } from "../Sidebar.logic";

export type SidebarTopStatus = {
  label: string;
  /** Null for calm statuses that carry only a label. */
  icon:
    | "waiting"
    | "working"
    | "approval"
    | "input"
    | "request"
    | "failed"
    | "woke"
    | "done"
    | null;
  className: string;
};

// Status hues follow the system-wide convention set by sidebar v1 and the
// mobile Live Activity/widgets (amber approval, indigo input, sky working)
// so a thread reads the same color everywhere it surfaces.
export function resolveSidebarTopStatus(
  status: ReturnType<typeof resolveSidebarThreadStatus>,
  isWoke: boolean,
  isUnread: boolean,
  resolve: MessageResolver = m,
): SidebarTopStatus | null {
  switch (status) {
    case "preparing":
      return { label: resolve(msg("Setting up")), icon: "working", className: "text-info" };
    case "working":
      // No shimmer: a label that animates forever is noise in a sidebar
      // full of them (and repaints every vsync on high-refresh displays).
      return {
        label: resolve(msg("Working", { $context: "thread status" })),
        icon: "working",
        className: "text-info",
      };
    case "waiting":
      // Waiting is calm background presence (post-settle background
      // roster), not active progress, so the label keeps full strength.
      return {
        label: resolve(msg("Waiting", { $context: "thread status" })),
        icon: "waiting",
        className: "text-muted-foreground",
      };
    case "approval":
      return {
        label: resolve(msg("Approval", { $context: "thread status, waiting for approval" })),
        icon: "approval",
        className: "text-warning-foreground",
      };
    case "input":
      return {
        label: resolve(msg("Input", { $context: "thread status, waiting for user input" })),
        icon: "input",
        className: "text-indigo-600 dark:text-indigo-300",
      };
    case "request":
      return {
        label: resolve(msg("Request", { $context: "thread status, waiting on a request" })),
        icon: "request",
        className: "text-guest-foreground",
      };
    case "limited":
      return {
        label: resolve(msg("Limited", { $context: "thread status, usage limit reached" })),
        icon: "failed",
        className: "text-warning",
      };
    case "failed":
      return {
        label: resolve(msg("Failed", { $context: "thread status" })),
        icon: "failed",
        className: "text-error",
      };
  }
  if (isWoke)
    return {
      label: resolve(msg("Woke", { $context: "thread status, woke from snooze" })),
      icon: "woke",
      className: "text-warning",
    };
  if (isUnread)
    return {
      label: resolve(msg("Done", { $context: "thread status" })),
      icon: "done",
      className: "text-success",
    };
  return null;
}

export function SidebarTopStatusIcon(props: { icon: SidebarTopStatus["icon"]; className: string }) {
  switch (props.icon) {
    case "working":
      return <CircleDashedIcon aria-hidden className={props.className} />;
    case "waiting":
      return <CircleDotDashedIcon aria-hidden className={props.className} />;
    case "input":
      return <MessageCircleQuestionIcon aria-hidden className={props.className} />;
    case "request":
      return <UserRoundIcon aria-hidden className={props.className} />;
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
