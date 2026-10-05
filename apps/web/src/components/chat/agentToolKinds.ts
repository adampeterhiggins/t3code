import type { SubagentToolKind } from "@t3tools/client-runtime/state/agent-list-view";
import {
  EyeIcon,
  GlobeIcon,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

/** Fork: how agent rows and the agent tab mark each family of tool call. */
export const TOOL_KIND_ICONS: Record<SubagentToolKind, LucideIcon> = {
  command: TerminalIcon,
  read: EyeIcon,
  edit: SquarePenIcon,
  search: SearchIcon,
  web: GlobeIcon,
  other: WrenchIcon,
};

export const TOOL_KIND_LABELS: Record<SubagentToolKind, string> = {
  command: "Commands",
  read: "Reads",
  edit: "Edits",
  search: "Searches",
  web: "Web",
  other: "Other tools",
};
