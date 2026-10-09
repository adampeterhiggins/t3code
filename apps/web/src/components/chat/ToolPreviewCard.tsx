import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  PullRequestToolPreview,
  RecordsToolPreview,
  ToolPreview,
} from "@t3tools/client-runtime/work-log/tool-preview";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useThreadShell } from "../../state/entities";
import { cn } from "../../lib/utils";
import { formatShortTimestamp } from "../../timestampFormat";
import { PullRequestStateGlyph } from "../pullRequest/pullRequestPresentation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { scheduleLabel } from "../settings/ScheduledTasksSettings";
import ChatMarkdown from "../ChatMarkdown";
import { resolveExternalWebLinkHref } from "./externalLinkContextMenu";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { ShellCommandBlock } from "./ShellCommandBlock";

// A search can return dozens of messages; the card is a glance, the raw call has the rest.
const MAX_SLACK_MESSAGES = 5;
const MAX_RECORDS = 8;
const MAX_TABLE_ROWS = 10;

const monoClassName =
  "font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

function StatusBadge({ status }: { readonly status: string | null }) {
  if (!status) return null;
  const variant =
    status === "completed"
      ? "success"
      : status === "failed" || status === "cancelled" || status === "interrupted"
        ? "error"
        : status === "running" || status === "working"
          ? "info"
          : "secondary";
  return (
    <Badge size="sm" variant={variant} className="shrink-0">
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

function Chip({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-block max-w-full rounded bg-muted px-1.5 font-mono text-2xs break-all text-foreground/85">
      {children}
    </span>
  );
}

function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const safeHref = resolveExternalWebLinkHref(href);
  if (!safeHref) return <span className="min-w-0 truncate">{children}</span>;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
    >
      <span className="min-w-0 truncate">{children}</span>
      <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}

function OpenThreadButton(props: {
  readonly threadId: string | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { threadId, onOpenThread } = props;
  if (!threadId) return null;
  return (
    <div>
      <Button size="xs" variant="outline" onClick={() => onOpenThread(ThreadId.make(threadId))}>
        Open thread
      </Button>
    </div>
  );
}

type PullRequestRow = PullRequestToolPreview["pullRequests"][number];

/**
 * A pull request row. Link and watch results name only the PR, so its title, state and
 * branch come from the thread's own snapshot of the PR when the thread links it.
 */
function PullRequestRowView(props: {
  readonly pr: PullRequestRow;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(
    useMemo(
      () => scopeThreadRef(props.environmentId, props.threadId),
      [props.environmentId, props.threadId],
    ),
  );
  const { pr } = props;
  const snapshot =
    pr.title === null
      ? (shell?.pullRequests.find(
          (link) =>
            link.url === pr.url || (link.repository === pr.repository && link.number === pr.number),
        )?.snapshot ?? null)
      : null;
  const title = pr.title ?? snapshot?.title ?? null;
  const state = pr.state ?? snapshot?.state ?? null;
  const isDraft = pr.state ? pr.isDraft : (snapshot?.isDraft ?? false);
  const branch = pr.headBranch ?? snapshot?.headBranch ?? null;
  return (
    <li className="min-w-0 space-y-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {state ? (
          <PullRequestStateGlyph state={state} isDraft={isDraft} className="size-3.5" />
        ) : null}
        <ExternalLink href={pr.url}>
          {title ?? (pr.repository && pr.number ? `${pr.repository}#${pr.number}` : pr.url)}
        </ExternalLink>
        {title && pr.number ? (
          <span className="shrink-0 font-mono text-muted-foreground">#{pr.number}</span>
        ) : null}
      </div>
      {branch || pr.note ? (
        <p className="truncate pl-5 text-muted-foreground">
          {[branch ? `${pr.repository ?? ""} ${branch}`.trim() : null, pr.note]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

/** A thread named by its title when this client knows it, opening the thread on click. */
function ThreadName(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly className?: string;
}) {
  const threadId = ThreadId.make(props.threadId);
  const shell = useThreadShell(
    useMemo(() => scopeThreadRef(props.environmentId, threadId), [props.environmentId, threadId]),
  );
  return (
    <button
      type="button"
      className={cn("min-w-0 truncate text-left hover:underline", props.className)}
      onClick={() => props.onOpenThread(threadId)}
    >
      {shell?.title ?? "Open thread"}
    </button>
  );
}

type GenericPreview = Extract<
  ToolPreview,
  { readonly kind: "records" | "table" | "document" | "properties" }
>;

/** The query, link out and notes above a generic card. */
function GenericHeader({ preview }: { readonly preview: GenericPreview }) {
  if (!preview.summary && !preview.link && preview.notes.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {preview.summary ? (
        <p className="line-clamp-2 font-mono text-2xs break-all text-muted-foreground">
          {preview.summary}
        </p>
      ) : null}
      {preview.notes.map((note) => (
        <p key={note} className="line-clamp-2 text-muted-foreground">
          {note}
        </p>
      ))}
      {preview.link ? (
        <div className="text-muted-foreground">
          <ExternalLink href={preview.link.url}>{preview.link.label}</ExternalLink>
        </div>
      ) : null}
    </div>
  );
}

function TitleLink(props: { readonly title: string; readonly url: string | null }) {
  return props.url ? (
    <ExternalLink href={props.url}>{props.title}</ExternalLink>
  ) : (
    <span className="min-w-0 truncate">{props.title}</span>
  );
}

function RecordsView(props: {
  readonly preview: RecordsToolPreview;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { preview } = props;
  const hidden = Math.max(0, preview.items.length - MAX_RECORDS) + preview.more;
  if (preview.items.length === 0)
    return <p className="text-muted-foreground italic">No results.</p>;
  return (
    <ul className="space-y-1.5">
      {preview.items.slice(0, MAX_RECORDS).map((item) => {
        const threadId = item.url ? null : item.threadId;
        return (
          <li key={item.key} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
              {threadId ? (
                <button
                  type="button"
                  className="min-w-0 truncate text-left hover:underline"
                  onClick={() => props.onOpenThread(ThreadId.make(threadId))}
                >
                  {item.title}
                </button>
              ) : (
                <TitleLink title={item.title} url={item.url} />
              )}
              {item.subtitle ? (
                <span className="ml-auto">
                  <StatusBadge status={item.subtitle} />
                </span>
              ) : null}
            </div>
            {item.meta.length > 0 ? (
              <p className="truncate text-muted-foreground">{item.meta.join(" · ")}</p>
            ) : null}
            {item.body ? (
              <p className="line-clamp-3 break-words whitespace-pre-wrap text-foreground/85">
                {item.body}
              </p>
            ) : null}
          </li>
        );
      })}
      {hidden > 0 ? <li className="text-muted-foreground">+{hidden} more</li> : null}
    </ul>
  );
}

function GenericBody(props: {
  readonly preview: GenericPreview;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { preview } = props;
  switch (preview.kind) {
    case "records":
      return (
        <RecordsView
          preview={preview}
          environmentId={props.environmentId}
          onOpenThread={props.onOpenThread}
        />
      );
    case "table": {
      const hidden = Math.max(0, preview.rows.length - MAX_TABLE_ROWS) + preview.more;
      return preview.rows.length === 0 ? (
        <p className="text-muted-foreground italic">No rows.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full border-collapse font-mono text-2xs">
            <thead>
              <tr>
                {preview.columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-border px-1.5 py-1 text-left font-medium text-muted-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
                // Rows have no identity of their own and never reorder.
                // oxlint-disable-next-line react/no-array-index-key
                <tr key={rowIndex}>
                  {preview.columns.map((column, cellIndex) => (
                    <td
                      key={column}
                      className="max-w-48 truncate border-b border-border/40 px-1.5 py-0.5 text-foreground/85"
                    >
                      {row[cellIndex]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hidden > 0 ? <p className="mt-1 text-muted-foreground">+{hidden} more rows</p> : null}
        </div>
      );
    }
    case "document":
      return (
        <>
          {preview.title ? (
            <p className="font-medium text-foreground">
              <TitleLink title={preview.title} url={preview.url} />
            </p>
          ) : preview.url ? (
            <ExternalLink href={preview.url}>Open</ExternalLink>
          ) : null}
          {preview.markdown ? (
            preview.preformatted ? (
              <pre className={cn("max-h-60 overflow-auto text-foreground/85", monoClassName)}>
                {preview.markdown}
              </pre>
            ) : (
              <div className="max-h-60 overflow-auto">
                <ChatMarkdown text={preview.markdown} cwd={props.cwd} />
              </div>
            )
          ) : null}
        </>
      );
    case "properties":
      return (
        <>
          {preview.title ? (
            <p className="font-medium text-foreground">
              <TitleLink title={preview.title} url={preview.url} />
            </p>
          ) : null}
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {preview.rows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="truncate text-muted-foreground">{key}</dt>
                <dd className="line-clamp-3 break-words text-foreground/85">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      );
  }
}

function WakeTime({ at }: { readonly at: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return <p className="text-foreground">Wakes at {formatShortTimestamp(at, timestampFormat)}</p>;
}

function PreviewBody(props: {
  readonly preview: ToolPreview;
  readonly environmentId: EnvironmentId;
  /** The thread the call ran in. */
  readonly threadId: ThreadId;
  readonly cwd: string | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { preview } = props;
  switch (preview.kind) {
    case "thread":
      return (
        <>
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 font-medium text-foreground">{preview.title}</span>
            <StatusBadge status={preview.status} />
          </div>
          {preview.model || preview.branch ? (
            <p className="text-muted-foreground">
              {[preview.model, preview.branch].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {preview.items.length > 0 ? (
            <ul className="space-y-1 border-l border-border/60 pl-2">
              {preview.items.map((item) => (
                <li key={item.key} className="line-clamp-3 break-words">
                  <span className="text-muted-foreground">{item.label} </span>
                  {item.text}
                </li>
              ))}
              {preview.moreItems > 0 ? (
                <li className="text-muted-foreground">+{preview.moreItems} earlier</li>
              ) : null}
            </ul>
          ) : null}
          <OpenThreadButton threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "task":
      return (
        <>
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 font-medium text-foreground">
              {preview.title ?? "Delegated task"}
            </span>
            <StatusBadge status={preview.status} />
          </div>
          {preview.model ? <p className="text-muted-foreground">{preview.model}</p> : null}
          {preview.summary ? (
            <p className="line-clamp-4 break-words text-foreground/85">{preview.summary}</p>
          ) : null}
          <OpenThreadButton threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "pull-requests":
      return preview.pullRequests.length === 0 ? (
        <p className="text-muted-foreground italic">No pull requests.</p>
      ) : (
        <ul className="space-y-1.5">
          {preview.pullRequests.map((pr) => (
            <PullRequestRowView
              key={pr.url}
              pr={pr}
              environmentId={props.environmentId}
              threadId={props.threadId}
            />
          ))}
        </ul>
      );
    case "browser":
      return (
        <>
          {preview.page ? (
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <ExternalLink href={preview.page.url}>
                {preview.page.title ?? preview.page.url}
              </ExternalLink>
              {preview.page.title ? (
                <span className="min-w-0 truncate font-mono text-2xs">{preview.page.url}</span>
              ) : null}
            </div>
          ) : null}
          {preview.target && preview.target !== preview.page?.url ? (
            <div>
              <Chip>{preview.target}</Chip>
            </div>
          ) : null}
          {preview.text ? <p className="break-words text-foreground/85">“{preview.text}”</p> : null}
          {preview.expression ? (
            <pre className={cn("rounded-md bg-muted/40 px-2 py-1.5", monoClassName)}>
              <HighlightedSnippet text={preview.expression} lang="javascript" />
            </pre>
          ) : null}
          {preview.value !== null ? (
            <pre className={cn("max-h-60 overflow-auto text-muted-foreground", monoClassName)}>
              → {preview.value}
            </pre>
          ) : null}
        </>
      );
    case "loaded-tools":
      return (
        <div className="flex flex-wrap gap-1">
          {preview.names.map((name) => (
            <Chip key={name}>{name}</Chip>
          ))}
        </div>
      );
    case "slack-messages":
      if (preview.messages.length === 0) {
        return <p className="text-muted-foreground italic">No messages found.</p>;
      }
      return (
        <ul className="space-y-2">
          {preview.messages.slice(0, MAX_SLACK_MESSAGES).map((message) => (
            <li
              key={`${message.time}\n${message.author}\n${message.text}`}
              className="border-l-2 border-border pl-2"
            >
              <p className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 font-medium text-foreground">{message.author}</span>
                {message.channel ? (
                  <span className="min-w-0 truncate text-muted-foreground">{message.channel}</span>
                ) : null}
                {message.time ? (
                  <span className="shrink-0 text-muted-foreground">{message.time}</span>
                ) : null}
                {message.url ? (
                  <span className="ml-auto shrink-0">
                    <ExternalLink href={message.url}>Open</ExternalLink>
                  </span>
                ) : null}
              </p>
              <p className="line-clamp-6 break-words whitespace-pre-wrap text-foreground/85">
                {message.text}
              </p>
            </li>
          ))}
          {preview.messages.length > MAX_SLACK_MESSAGES ? (
            <li className="text-muted-foreground">
              +{preview.messages.length - MAX_SLACK_MESSAGES} more
            </li>
          ) : null}
        </ul>
      );
    case "questions":
      return (
        <div className="space-y-2">
          {preview.questions.map((question) => (
            <div key={question.question} className="space-y-0.5">
              <p className="font-medium text-foreground">{question.question}</p>
              {question.options.map((option) => (
                <p
                  key={option.label}
                  className={cn(
                    "flex items-baseline gap-1.5",
                    option.selected ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 translate-y-px rounded-full border",
                      option.selected ? "border-primary bg-primary" : "border-muted-foreground",
                    )}
                  />
                  {option.label}
                </p>
              ))}
              {question.otherAnswer ? (
                <p className="text-foreground">Answered: {question.otherAnswer}</p>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "agent-message":
      return (
        <>
          {preview.recipient ? (
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              To <Chip>{preview.recipient}</Chip>
            </div>
          ) : null}
          {preview.summary ? (
            <p className="font-medium text-foreground">{preview.summary}</p>
          ) : null}
          {preview.message ? (
            <div className="max-h-60 overflow-auto">
              <ChatMarkdown text={preview.message} cwd={props.cwd} lineBreaks />
            </div>
          ) : null}
          <OpenThreadButton threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "skill":
      return (
        <>
          <div>
            <Chip>/{preview.skill}</Chip>
          </div>
          {preview.args ? (
            <p className="break-words whitespace-pre-wrap text-foreground/85">{preview.args}</p>
          ) : null}
        </>
      );
    case "monitor":
      return (
        <>
          {preview.description ? (
            <p className="font-medium text-foreground">{preview.description}</p>
          ) : null}
          <div className={cn("max-h-40 overflow-auto", monoClassName)}>
            <ShellCommandBlock command={preview.command} highlightSyntax />
          </div>
        </>
      );
    case "wakeup":
      return (
        <>
          {preview.at ? <WakeTime at={preview.at} /> : null}
          {preview.reason ? <p className="text-muted-foreground">{preview.reason}</p> : null}
          {preview.prompt ? (
            <p className="line-clamp-4 break-words text-foreground/85">{preview.prompt}</p>
          ) : null}
        </>
      );
    case "thread-action":
      return (
        <>
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 font-medium text-foreground">{preview.headline}</span>
            <StatusBadge status={preview.status} />
          </div>
          {preview.details.map((detail) => (
            <p key={detail} className="break-words text-muted-foreground">
              {detail}
            </p>
          ))}
          {preview.threadId && preview.threadId !== props.threadId ? (
            <ThreadName
              environmentId={props.environmentId}
              threadId={preview.threadId}
              onOpenThread={props.onOpenThread}
              className="block text-foreground/85"
            />
          ) : null}
        </>
      );
    case "thread-search":
      return (
        <>
          {preview.query ? (
            <p className="text-muted-foreground">
              “{preview.query}” · {preview.matches.length} match
              {preview.matches.length === 1 ? "" : "es"}
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {preview.matches.map((match) => (
              <li key={`${match.threadId}\n${match.snippet}`} className="min-w-0">
                <ThreadName
                  environmentId={props.environmentId}
                  threadId={match.threadId}
                  onOpenThread={props.onOpenThread}
                  className="block font-medium text-foreground"
                />
                {match.snippet ? (
                  <p className="line-clamp-2 break-words text-muted-foreground">
                    {match.source ? `${match.source}: ` : ""}
                    {match.snippet}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      );
    case "context-transfers":
      return preview.transfers.length === 0 ? (
        <p className="text-muted-foreground italic">No context transfers.</p>
      ) : (
        <ul className="space-y-1">
          {preview.transfers.map((transfer) => (
            <li key={transfer.id} className="flex min-w-0 items-center gap-1.5">
              <ThreadName
                environmentId={props.environmentId}
                threadId={transfer.sourceThreadId}
                onOpenThread={props.onOpenThread}
                className="text-foreground/85"
              />
              <span className="shrink-0 text-muted-foreground">→</span>
              <ThreadName
                environmentId={props.environmentId}
                threadId={transfer.targetThreadId}
                onOpenThread={props.onOpenThread}
                className="text-foreground/85"
              />
              <span className="ml-auto">
                <StatusBadge status={transfer.status} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "threads":
      return preview.threads.length === 0 ? (
        <p className="text-muted-foreground italic">No threads.</p>
      ) : (
        <ul className="space-y-1">
          {preview.threads.map((thread) => (
            <li key={thread.threadId} className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                className="min-w-0 truncate text-left text-foreground hover:underline"
                onClick={() => props.onOpenThread(ThreadId.make(thread.threadId))}
              >
                {thread.title}
              </button>
              {thread.model ? (
                <span className="shrink-0 text-muted-foreground">{thread.model}</span>
              ) : null}
              <span className="ml-auto">
                <StatusBadge status={thread.status} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "scheduled-tasks":
      return preview.tasks.length === 0 ? (
        <p className="text-muted-foreground italic">No scheduled tasks.</p>
      ) : (
        <ul className="space-y-1">
          {preview.tasks.map((task) => (
            <li key={task.id} className="min-w-0">
              <p className="truncate font-medium text-foreground">{task.title}</p>
              <p className="truncate text-muted-foreground">
                {[
                  task.schedule ? scheduleLabel(task.schedule) : null,
                  task.enabled ? null : "paused",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      );
    case "records":
    case "table":
    case "document":
    case "properties":
      return (
        <>
          <GenericHeader preview={preview} />
          <GenericBody
            preview={preview}
            environmentId={props.environmentId}
            cwd={props.cwd}
            onOpenThread={props.onOpenThread}
          />
        </>
      );
    case "html-page":
      return (
        <>
          {preview.title ? <p className="font-medium text-foreground">{preview.title}</p> : null}
          {preview.details.length > 0 ? (
            <p className="text-muted-foreground">{preview.details.join(" · ")}</p>
          ) : null}
        </>
      );
  }
}

/**
 * A tool call shown as what it did rather than its arguments and JSON result.
 * The raw call stays one click away, and mounts only when asked for.
 */
export function ToolPreviewCard(props: {
  readonly preview: ToolPreview;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly images: ReactNode;
  /** The generic body, mounted only once asked for. */
  readonly raw: ReactNode;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="space-y-1.5 text-xs" data-tool-preview={props.preview.kind}>
      <PreviewBody {...props} />
      <div className="space-y-1.5">{props.images}</div>
      <button
        type="button"
        className="text-2xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowRaw((shown) => !shown)}
      >
        {showRaw ? "Hide raw call" : "Show raw call"}
      </button>
      {showRaw ? props.raw : null}
    </div>
  );
}
