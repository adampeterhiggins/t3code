import type { ChatThreadMessage } from "@t3tools/contracts";
import { ArrowUpRightIcon, FileIcon } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "~/timestampFormat";
import ChatMarkdown from "./ChatMarkdown";
import { remarkChatMentions } from "./chatThreadMentions";
import { chatThreadRows } from "./chatThreadRows";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * A captured Slack or Discord thread drawn the way those apps draw one: who said what, with the
 * linked message highlighted. Records from before messages were captured show their markdown.
 */
export function ChatThreadDetails(props: {
  icon: ReactNode;
  linkLabel: string;
  record: {
    readonly channelLabel: string;
    readonly scope: "thread" | "message";
    readonly replyCount: number;
    readonly url: string;
    readonly markdown: string;
    readonly messages?: ReadonlyArray<ChatThreadMessage> | undefined;
  };
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
  fallback: ReactNode;
}) {
  const { record } = props;
  return (
    <div className="flex flex-col">
      <div className="flex h-8 items-center gap-1.5 border-b border-border/70 pb-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
        {props.icon}
        <span className="text-sm font-semibold">
          {record.scope === "thread" ? "Thread" : "Message"}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {record.channelLabel}
        </span>
        <a
          href={record.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(event) => props.onOpenLink(event, record.url)}
        >
          {props.linkLabel}
          <ArrowUpRightIcon className="size-3" />
        </a>
      </div>
      {record.messages === undefined ? (
        <div className="pt-2">{props.fallback}</div>
      ) : (
        <ChatThreadMessages messages={record.messages} replyCount={record.replyCount} />
      )}
    </div>
  );
}

function ChatThreadMessages(props: {
  messages: ReadonlyArray<ChatThreadMessage>;
  replyCount: number;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return (
    <div className="-mx-2 max-h-80 overflow-y-auto pt-1.5">
      {chatThreadRows(props.messages, props.replyCount).map((row) => {
        switch (row.type) {
          case "replies":
            return (
              <div
                key="replies"
                className="flex items-center gap-2.5 px-2 pt-2 pb-1 text-xs text-muted-foreground after:h-px after:flex-1 after:bg-border"
              >
                {row.count} {row.count === 1 ? "reply" : "replies"}
              </div>
            );
          case "omitted":
            return (
              <p
                key={`omitted-${row.from}`}
                className="py-0.5 pr-2 pl-12.5 text-2xs text-muted-foreground italic"
              >
                {row.count} {row.count === 1 ? "message" : "messages"} omitted
              </p>
            );
          case "message": {
            const { message } = row;
            return (
              <div
                key={message.index}
                className={cn(
                  "flex gap-2.5 rounded-md px-2 py-1.5",
                  message.linked && "bg-warning/12",
                )}
              >
                <ChatThreadAvatar name={message.authorName} url={message.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-xs font-bold">{message.authorName}</span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <time
                            dateTime={message.postedAt}
                            className="shrink-0 text-2xs text-muted-foreground tabular-nums"
                          />
                        }
                      >
                        {formatDayAwareTimestamp(message.postedAt, timestampFormat)}
                      </TooltipTrigger>
                      <TooltipPopup side="top">
                        {formatChatTimestampTooltip(message.postedAt, timestampFormat)}
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                  {message.text.length > 0 ? (
                    <ChatMarkdown
                      text={message.text}
                      cwd={undefined}
                      lineBreaks
                      className="chat-thread-markdown text-xs"
                      extraRemarkPlugins={[[remarkChatMentions, message.mentions ?? []]]}
                    />
                  ) : null}
                  {message.files.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {message.files.map((file, index) => (
                        <span
                          // oxlint-disable-next-line react/no-array-index-key -- two files can share a name
                          key={index}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-2xs text-muted-foreground"
                        >
                          <FileIcon className="size-3 shrink-0" />
                          <span className="truncate">{file}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          }
        }
      })}
    </div>
  );
}

/** The author's picture, or their initials when there is none or it fails to load. */
function ChatThreadAvatar(props: { name: string; url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (props.url !== null && props.url !== failedUrl) {
    return (
      <img
        src={props.url}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-8 shrink-0 rounded-lg bg-muted object-cover"
        onError={() => setFailedUrl(props.url)}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold text-white"
      style={{ backgroundColor: `oklch(0.56 0.11 ${nameHue(props.name)})` }}
    >
      {initials(props.name)}
    </div>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((word) => [...word][0]!.toUpperCase()).join("") || "?";
}

/** A stable hue per name, so one person keeps one colour across threads. */
function nameHue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  return hash;
}
