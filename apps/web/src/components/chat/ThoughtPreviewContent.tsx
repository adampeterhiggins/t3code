import { BrainIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useFollowLive } from "./WorkLog";

/**
 * A thought's hover card body, laid out like a tool call preview. `children` is the thought's
 * markdown. While it streams the card follows the newest text until the reader scrolls up.
 */
export function ThoughtPreviewContent(props: {
  readonly streaming: boolean;
  readonly timestamp: string;
  readonly children: ReactNode;
}) {
  const follow = useFollowLive(props.streaming);
  return (
    <div {...follow} className="flex max-h-[60vh] flex-col gap-1.5 overflow-auto p-3">
      <div className="flex items-center gap-1.5 text-xs text-secondary-label">
        <BrainIcon aria-hidden className="size-3.5 shrink-0 text-icon-muted" />
        {props.streaming ? "Thinking" : "Thought"}
      </div>
      <div className="select-text">{props.children}</div>
      <p className="font-mono text-3xs text-muted-foreground select-text">{props.timestamp}</p>
    </div>
  );
}
