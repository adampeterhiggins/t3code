/* oxlint-disable react/no-array-index-key -- Read-only preview rows can repeat identical text and have no local state. */
import type {
  CheckoutContextRecord,
  DiscordThreadContextRecord,
  GitHubIssueContextRecord,
  GitHubRefContextRecord,
  GranolaNoteContextRecord,
  LinearObjectContextRecord,
  NotionPageContextRecord,
  PromptLinkContextRecord,
  RepositoryContextRecord,
  SlackThreadContextRecord,
  UnreadLinkContextRecord,
} from "@t3tools/contracts";
import {
  contextRepositoryOutcomeLabel,
  describeContextRepositoryGitStatus,
} from "@t3tools/client-runtime/context-repositories";
import {
  parseThreadTabSummary,
  threadTabSummaryTools,
  type ThreadTabSummaryBlock,
  type ThreadTabSummaryChat,
  type ThreadTabSummaryRole,
} from "@t3tools/client-runtime/thread-tab-summary";
import { composerObjectLinkNoun } from "@t3tools/source-control-definitions/composerObjectLinks";
import { UnlinkIcon } from "lucide-react";
import { Fragment, type ComponentProps, type MouseEvent } from "react";

import { formatLinearMarkdownForPreview } from "~/lib/linearMarkdown";
import { cn } from "~/lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import { ChatThreadDetails } from "./ChatThreadDetails";
import { PreviewCornerAction } from "./chat/PreviewCornerAction";
import { ContextChipButton } from "./contextChipParts";
import { gitHubRefTypeLabel } from "./gitHubRefPresentation";
import { DiscordIcon, SlackIcon } from "./Icons";
import { Button } from "./ui/button";

/**
 * Popover body for a chat-tab summary chip, shared by the composer and sent messages: the
 * summary the agent receives, laid out by turn. Text in another shape shows as written.
 */
export function ThreadTabSummaryDetails({ summary }: { summary: string }) {
  const chats = parseThreadTabSummary(summary);
  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs text-foreground">
      {chats === null ? (
        <p className="whitespace-pre-wrap wrap-break-word">{summary}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {chats.map((chat, index) => (
            <ThreadTabSummaryChatDetails key={index} chat={chat} />
          ))}
        </div>
      )}
    </div>
  );
}

const THREAD_TAB_SUMMARY_ROLE_LABELS = {
  user: "User",
  assistant: "Agent",
  reasoning: "Thinking",
  tools: "Tools",
  error: "Error",
} as const satisfies Record<ThreadTabSummaryRole, string>;

function ThreadTabSummaryChatDetails({ chat }: { chat: ThreadTabSummaryChat }) {
  const fileCount = chat.files.length + chat.moreFiles;
  const facts = [
    chat.latestTurn ? `Latest turn ${chat.latestTurn}` : null,
    fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"} changed` : null,
  ].filter((fact) => fact !== null);
  // Each user message opens a turn, as in the summary.
  const turns: ThreadTabSummaryBlock[][] = [];
  for (const block of chat.blocks) {
    if (turns.length === 0 || block.kind === "omitted" || block.role === "user") turns.push([]);
    turns.at(-1)!.push(block);
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="wrap-break-word font-medium text-sm">{chat.title}</p>
        {facts.length > 0 ? <p className="text-muted-foreground">{facts.join(" · ")}</p> : null}
      </div>
      {chat.files.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-muted-foreground">Files changed</p>
          <ul className="flex flex-col gap-0.5 font-mono text-muted-foreground">
            {chat.files.map((file) => {
              const stats = / \(\+\d+ −\d+\)$/.exec(file);
              return (
                <li key={file} className="flex gap-2">
                  {/* Truncates from the left, keeping the file name in view. */}
                  <span className="min-w-0 truncate text-left [direction:rtl]">
                    <span dir="ltr">{stats ? file.slice(0, stats.index) : file}</span>
                  </span>
                  {stats ? <span className="shrink-0">{stats[0].trim()}</span> : null}
                </li>
              );
            })}
            {chat.moreFiles > 0 ? <li>…and {chat.moreFiles} more</li> : null}
          </ul>
        </div>
      ) : null}
      {chat.plan ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-muted-foreground">Latest plan</p>
          <ChatMarkdown text={chat.plan} cwd={undefined} className="text-xs" />
        </div>
      ) : null}
      {turns.length === 0 ? (
        <p className="text-muted-foreground">No messages yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/70 border-t border-border/70">
          {turns.map((turn, turnIndex) => (
            <div
              key={turnIndex}
              className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-2.5"
            >
              {turn.map((block, index) =>
                block.kind === "omitted" ? (
                  <p key={index} className="col-span-2 text-center text-muted-foreground">
                    {block.turns} earlier {block.turns === 1 ? "turn" : "turns"} not included
                  </p>
                ) : (
                  <Fragment key={index}>
                    <p className="font-medium text-muted-foreground">
                      {THREAD_TAB_SUMMARY_ROLE_LABELS[block.role]}
                    </p>
                    <ThreadTabSummaryEntry role={block.role} text={block.text} />
                  </Fragment>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ThreadTabSummaryEntry({ role, text }: { role: ThreadTabSummaryRole; text: string }) {
  switch (role) {
    case "reasoning":
      return (
        <p className="whitespace-pre-wrap wrap-break-word text-muted-foreground italic">{text}</p>
      );
    case "tools":
      return (
        <ul className="flex min-w-0 flex-col gap-0.5 font-mono text-muted-foreground">
          {threadTabSummaryTools(text).map((tool, index) => (
            <li key={index} className={cn("wrap-break-word", tool.failed && "text-destructive")}>
              {tool.label}
              {tool.failed ? " (failed)" : null}
            </li>
          ))}
        </ul>
      );
    case "error":
      return <p className="whitespace-pre-wrap wrap-break-word text-destructive">{text}</p>;
    case "assistant":
      return <ChatMarkdown text={text} cwd={undefined} className="text-xs" />;
    case "user":
      return <p className="whitespace-pre-wrap wrap-break-word">{text}</p>;
  }
}

/**
 * An issue snapshot's markdown body: the heading, facts, description, and comments the agent
 * receives, scrolling when long.
 */
function IssueMarkdownBody({ text }: { text: string }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs text-foreground">
      <ChatMarkdown text={text} cwd={undefined} />
    </div>
  );
}

/** A Linear issue snapshot, with bare Linear links given readable names. */
export function LinearIssueMarkdown({ markdown, url }: { markdown: string; url: string }) {
  const text = formatLinearMarkdownForPreview(markdown, url);
  return <IssueMarkdownBody text={text} />;
}

/** A GitHub issue snapshot, rendered by the server from its description and comments. */
function GitHubIssueMarkdown({ markdown }: { markdown: string }) {
  return <IssueMarkdownBody text={markdown} />;
}

/** The header row over an issue snapshot: what it is, and a link back to where it lives. */
function IssueDetailsHeader(props: {
  summary: string;
  url: string;
  linkLabel: string;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{props.summary}</span>
      <a
        href={props.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
        onClick={(event) => props.onOpenLink(event, props.url)}
      >
        {props.linkLabel}
      </a>
    </div>
  );
}

/** An attached Linear issue: the snapshot the agent received, with a link back to Linear. */
export function LinearIssueDetails(props: {
  identifier: string;
  stateName: string;
  url: string;
  markdown: string;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={`${props.identifier} · ${props.stateName}`}
        url={props.url}
        linkLabel="Open in Linear"
        onOpenLink={props.onOpenLink}
      />
      <LinearIssueMarkdown markdown={props.markdown} url={props.url} />
    </div>
  );
}

const LINEAR_OBJECT_KIND_LABELS: Record<LinearObjectContextRecord["objectType"], string> = {
  project: "Linear project",
  document: "Linear document",
  initiative: "Linear initiative",
};

export function linearObjectKindLabel(objectType: LinearObjectContextRecord["objectType"]) {
  return LINEAR_OBJECT_KIND_LABELS[objectType];
}

/** An attached Linear project, document, or initiative: the snapshot the agent received. */
export function LinearObjectDetails(props: {
  record: Pick<LinearObjectContextRecord, "objectType" | "status" | "url" | "markdown">;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { record } = props;
  const kind = linearObjectKindLabel(record.objectType);
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={record.status === null ? kind : `${kind} · ${record.status}`}
        url={record.url}
        linkLabel="Open in Linear"
        onOpenLink={props.onOpenLink}
      />
      <LinearIssueMarkdown markdown={record.markdown} url={record.url} />
    </div>
  );
}

/** An attached GitHub issue: the snapshot the agent received, with a link back to GitHub. */
export function GitHubIssueDetails(props: {
  record: Pick<GitHubIssueContextRecord, "repository" | "number" | "state" | "url" | "markdown">;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { record } = props;
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={`${record.repository}#${record.number} · ${record.state === "open" ? "Open" : "Closed"}`}
        url={record.url}
        linkLabel="Open on GitHub"
        onOpenLink={props.onOpenLink}
      />
      <GitHubIssueMarkdown markdown={record.markdown} />
    </div>
  );
}

/**
 * An attached GitHub release, tag, branch, or commit: the release notes or commit message the
 * agent received, with a link back to GitHub.
 */
export function GitHubRefDetails(props: {
  record: Pick<GitHubRefContextRecord, "repository" | "refType" | "ref" | "url" | "markdown">;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { record } = props;
  const name = record.refType === "commit" ? record.ref.slice(0, 7) : record.ref;
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={`${record.repository} · ${gitHubRefTypeLabel(record.refType)} ${name}`}
        url={record.url}
        linkLabel="Open on GitHub"
        onOpenLink={props.onOpenLink}
      />
      <IssueMarkdownBody text={record.markdown} />
    </div>
  );
}

/** An attached Slack thread or message: the snapshot the agent received, with a link back. */
export function SlackThreadDetails(props: {
  record: Pick<
    SlackThreadContextRecord,
    "channelLabel" | "scope" | "replyCount" | "url" | "markdown" | "messages"
  >;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <ChatThreadDetails
      icon={<SlackIcon />}
      linkLabel="Open in Slack"
      record={props.record}
      onOpenLink={props.onOpenLink}
      fallback={<IssueMarkdownBody text={props.record.markdown} />}
    />
  );
}

/** An attached Discord thread or message: the snapshot the agent received, with a link back. */
export function DiscordThreadDetails(props: {
  record: Pick<
    DiscordThreadContextRecord,
    "channelLabel" | "scope" | "replyCount" | "url" | "markdown" | "messages"
  >;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <ChatThreadDetails
      icon={<DiscordIcon />}
      linkLabel="Open in Discord"
      record={props.record}
      onOpenLink={props.onOpenLink}
      fallback={<IssueMarkdownBody text={props.record.markdown} />}
    />
  );
}

/**
 * An attached repository: where it goes and, once sent, what the server did with it. The draft
 * has no outcome yet; the clone happens when the message sends.
 */
/** Snapshot of a local checkout referenced in a message. */
export function CheckoutDetails(props: {
  record: CheckoutContextRecord;
  onOpen?: () => void;
  onLink?: () => void;
}) {
  const { record } = props;
  return (
    <div className="flex w-72 flex-col gap-2 text-xs">
      {props.onOpen || props.onLink ? (
        <div className="flex justify-end gap-3">
          {props.onOpen ? (
            <PreviewCornerAction onClick={props.onOpen}>Open in editor</PreviewCornerAction>
          ) : null}
          {props.onLink ? (
            <PreviewCornerAction onClick={props.onLink}>Link to thread</PreviewCornerAction>
          ) : null}
        </div>
      ) : null}
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
        <dt className="text-muted-foreground">Path</dt>
        <dd className="truncate font-mono">{record.path}</dd>
        <dt className="text-muted-foreground">Branch</dt>
        <dd className="truncate font-mono">{record.branch ?? "detached HEAD"}</dd>
        <dt className="text-muted-foreground">HEAD</dt>
        <dd className="truncate font-mono">{record.headSha?.slice(0, 12) ?? "unknown"}</dd>
        <dt className="text-muted-foreground">Changes</dt>
        <dd className={record.changedFiles > 0 ? "text-warning" : undefined}>
          {record.changedFiles === 0
            ? "clean"
            : `${record.changedFiles} uncommitted file${record.changedFiles === 1 ? "" : "s"}`}
        </dd>
        <dt className="text-muted-foreground">Agent</dt>
        <dd>{record.access === "read" ? "Read access for this turn" : "Path shared only"}</dd>
      </dl>
    </div>
  );
}

export function RepositoryDetails(props: {
  record: RepositoryContextRecord;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { record } = props;
  const outcome = record.outcome;
  const browsable = /^https?:\/\//i.test(record.remoteUrl);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span className="min-w-0 truncate">{record.nameWithOwner}</span>
        {browsable ? (
          <a
            href={record.remoteUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
            onClick={(event) => props.onOpenLink(event, record.remoteUrl)}
          >
            Open repository
          </a>
        ) : null}
      </div>
      {outcome ? (
        <>
          <p
            className={
              outcome.status === "failed" || outcome.status === "conflict"
                ? "text-warning"
                : "text-foreground"
            }
          >
            {contextRepositoryOutcomeLabel(outcome)}
          </p>
          {outcome.detail ? <p className="text-muted-foreground">{outcome.detail}</p> : null}
          {outcome.git ? (
            <p className="text-muted-foreground">
              {describeContextRepositoryGitStatus(outcome.git)}
              {outcome.git.upstream && !outcome.fetched ? " (as of the last fetch)" : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground">
          Cloned into the workspace's context folder as {record.directoryName} when you send, unless
          it is already there.
        </p>
      )}
    </div>
  );
}

/**
 * A link T3 Code tried to attach and could not read. Its chip is drawn as failed so it reads
 * differently from a plain link nobody tried; the agent receives the link itself.
 */
export function UnreadLinkDetails(props: {
  record: Pick<UnreadLinkContextRecord, "url" | "linkKind" | "reason">;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
  /** Composer only: a sent message keeps what was sent. */
  onRetry?: (() => void) | undefined;
  onKeepAsText?: (() => void) | undefined;
}) {
  const noun = composerObjectLinkNoun(props.record.linkKind);
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={
          props.record.reason === "timed-out"
            ? `Loading this ${noun} timed out`
            : `Could not read this ${noun}`
        }
        url={props.record.url}
        linkLabel="Open link"
        onOpenLink={props.onOpenLink}
      />
      <p className="text-xs text-muted-foreground">
        The agent receives the link, not its contents.
      </p>
      {props.onRetry || props.onKeepAsText ? (
        <div className="flex gap-2">
          {props.onRetry ? (
            <Button size="xs" variant="outline" onClick={props.onRetry}>
              Retry
            </Button>
          ) : null}
          {props.onKeepAsText ? (
            <Button size="xs" variant="ghost" onClick={props.onKeepAsText}>
              Keep as text
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The failed chip an unread link is drawn as. */
export function UnreadLinkChipTrigger({
  record,
  ...props
}: Omit<ComponentProps<typeof ContextChipButton>, "kind" | "icon" | "label"> & {
  record: Pick<UnreadLinkContextRecord, "label" | "linkKind">;
}) {
  return (
    <ContextChipButton
      kind="neutral"
      state="invalid"
      icon={<UnlinkIcon />}
      label={record.label}
      aria-label={`${unreadLinkAccessibleLabel(record)}. Show details`}
      {...props}
    />
  );
}

export function unreadLinkAccessibleLabel(
  record: Pick<UnreadLinkContextRecord, "label" | "linkKind">,
): string {
  return `Could not attach ${composerObjectLinkNoun(record.linkKind)}, ${record.label}`;
}

/** When the meeting happened, as the note's hover summary shows it. */
function granolaMeetingDate(meetingAt: string | null): string {
  const date = meetingAt === null ? null : new Date(meetingAt);
  return date === null || Number.isNaN(date.getTime())
    ? "Meeting note"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** An attached Granola note: the summary the agent received, with a link back to Granola. */
export function GranolaNoteDetails({
  record,
  onOpenLink,
}: {
  record: Pick<GranolaNoteContextRecord, "meetingAt" | "url" | "markdown">;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={granolaMeetingDate(record.meetingAt)}
        url={record.url}
        linkLabel="Open in Granola"
        onOpenLink={onOpenLink}
      />
      <IssueMarkdownBody text={record.markdown} />
    </div>
  );
}

/**
 * A T3 Code prompt link: the prompt it opens with, as plain text so nothing in it renders away,
 * and a link that opens it.
 */
export function PromptLinkDetails({
  record,
  onOpenLink,
}: {
  record: Pick<PromptLinkContextRecord, "url" | "prompt" | "target">;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={record.target ?? "New thread"}
        url={record.url}
        linkLabel="Open in T3 Code"
        onOpenLink={onOpenLink}
      />
      {record.prompt === null ? null : (
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs text-foreground">
          {record.prompt}
        </div>
      )}
    </div>
  );
}

export function NotionPageDetails({
  record,
  onOpenLink,
}: {
  record: NotionPageContextRecord;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <IssueDetailsHeader
        summary={record.title}
        url={record.url}
        linkLabel="Open in Notion"
        onOpenLink={onOpenLink}
      />
      <IssueMarkdownBody text={record.markdown} />
    </div>
  );
}
