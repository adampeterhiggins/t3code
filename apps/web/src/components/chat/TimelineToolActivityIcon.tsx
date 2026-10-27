import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { type ToolActivityIcon } from "@t3tools/contracts";
import { INTEGRATION_ICONS, toolActivityBrandMark } from "@t3tools/shared/brandMarks";
import { T3Wordmark } from "../T3Wordmark";
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  ListTodoIcon,
  MessageCircleIcon,
  SearchIcon,
  SmartphoneIcon,
  SquarePenIcon,
  TerminalIcon,
  HammerIcon,
  WrenchIcon,
  Code2Icon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";

export const failedToolIconClassName = "text-tool-error-icon/40";

export type WorkEntryIconName =
  | "bot"
  | "brain"
  | "browser"
  | "check"
  | "list-todo"
  | "circle-alert"
  | "computer"
  | "code"
  | "device"
  | "eye"
  | "globe"
  | "hammer"
  | "message-circle"
  | "search"
  | "square-pen"
  | "terminal"
  | "pull-request"
  | "t3-code"
  | "wrench"
  | "x"
  | "zap";

function BrowserAppIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8.5 19H7.2C4.4 19 3 17.5 3 14.6V7.4C3 4.5 4.5 3 7.4 3h8.2C18.5 3 20 4.5 20 7.4v2.4" />
      <circle cx="7.4" cy="7.2" r="0.75" fill="currentColor" stroke="none" />
      <path d="M11.2 7.2h4.3" />
      <path d="m12.4 11.4 7.5 2.6-3.4 1.6-1.5 3.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ToolActivityIconView(props: {
  icon: ToolActivityIcon | undefined;
  fallbackName: WorkEntryIconName;
  className: string;
  muted: boolean;
}) {
  const className = cn(props.className, props.muted && "opacity-70 light:brightness-60");
  const brandMark = props.icon && toolActivityBrandMark(props.icon);
  if (brandMark) {
    const mark = INTEGRATION_ICONS[brandMark];
    return (
      <svg viewBox={mark.viewBox} fill="currentColor" className={className} aria-hidden>
        <path d={mark.path} transform={"transform" in mark ? mark.transform : undefined} />
      </svg>
    );
  }
  return <WorkEntryIcon name={props.fallbackName} className={className} />;
}

function WorkEntryIcon({ name, className }: { name: WorkEntryIconName; className: string }) {
  switch (name) {
    case "pull-request":
      return <PullRequestGlyph.pullRequest className={className} aria-hidden />;
    case "bot":
      return <BotIcon className={className} aria-hidden />;
    case "brain":
      return <BrainIcon className={className} aria-hidden />;
    case "browser":
    case "computer":
      return <BrowserAppIcon className={className} />;
    case "code":
      return <Code2Icon className={className} aria-hidden />;
    case "device":
      return <SmartphoneIcon className={className} aria-hidden />;
    case "t3-code":
      return <T3Wordmark className={className} aria-hidden />;
    case "check":
      return <CheckIcon className={className} aria-hidden />;
    case "list-todo":
      return <ListTodoIcon className={className} aria-hidden />;
    case "circle-alert":
      return <CircleAlertIcon className={className} aria-hidden />;
    case "eye":
      return <EyeIcon className={className} aria-hidden />;
    case "globe":
      return <GlobeIcon className={className} aria-hidden />;
    case "hammer":
      return <HammerIcon className={className} aria-hidden />;
    case "search":
      return <SearchIcon className={className} aria-hidden />;
    case "message-circle":
      return <MessageCircleIcon className={className} aria-hidden />;
    case "square-pen":
      return <SquarePenIcon className={className} aria-hidden />;
    case "terminal":
      return <TerminalIcon className={className} aria-hidden />;
    case "wrench":
      return <WrenchIcon className={className} aria-hidden />;
    case "x":
      return <XIcon className={className} aria-hidden />;
    case "zap":
      return <ZapIcon className={className} aria-hidden />;
  }
}
