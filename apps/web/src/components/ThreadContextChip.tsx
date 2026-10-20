import type { ThreadContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { useThreadShell } from "~/state/entities";
import { ContextChip, ContextChipLabel } from "./ContextChip";

/** A referenced thread's chip, titled as the thread is now. The thread preview is its hover. */
export function ThreadChipTrigger({
  record,
  copyMarkdown,
  unreadable,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render" | "children"> & {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  copyMarkdown?: string | undefined;
  unreadable?: boolean | undefined;
}) {
  const { environmentId, threadId } = record;
  const shell = useThreadShell({ environmentId, threadId });
  const title = shell?.title?.trim() || record.title;
  return (
    <ContextChip
      kind="thread"
      {...(unreadable ? { state: "invalid" as const } : {})}
      render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
      aria-label={`Thread, ${title}`}
      data-markdown-copy={copyMarkdown}
      className="no-underline"
      {...props}
    >
      <MessagesSquareIcon />
      <ContextChipLabel>{title}</ContextChipLabel>
    </ContextChip>
  );
}
