import type { ScheduledTaskSchedule } from "@t3tools/contracts";
import type {
  ProviderCapabilitiesToolPreview,
  ToolPreview,
} from "@t3tools/client-runtime/work-log/tool-preview";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { m, type MessageResolver } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { tryOpenExternalUrl, type ExternalUrlTarget } from "../../lib/openExternalUrl";
import {
  describeSchedule,
  formatScheduledTaskInterval,
} from "../settings/scheduledTaskPresentation";

const MAX_SLACK_MESSAGES = 5;
const MAX_RECORDS = 8;
const MAX_TABLE_ROWS = 10;

type GenericPreview = Extract<
  ToolPreview,
  { readonly kind: "records" | "table" | "document" | "properties" }
>;

/** The query, link out and notes above a generic card. */
function GenericHeader({ preview }: { readonly preview: GenericPreview }) {
  return (
    <>
      {preview.summary ? (
        <Text selectable numberOfLines={2} className="font-mono text-2xs text-foreground-muted">
          {preview.summary}
        </Text>
      ) : null}
      {preview.notes.map((note) => (
        <Text key={note} numberOfLines={2} className="text-2xs text-foreground-muted">
          {note}
        </Text>
      ))}
      {preview.link ? (
        <Link url={preview.link.url} target="markdown-link">
          {preview.link.label}
        </Link>
      ) : null}
    </>
  );
}

function GenericBody(props: {
  readonly preview: GenericPreview;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const { preview } = props;
  const gt = useGT();
  switch (preview.kind) {
    case "records": {
      const hidden = Math.max(0, preview.items.length - MAX_RECORDS) + preview.more;
      return preview.items.length === 0 ? (
        <Muted>{gt("No results.")}</Muted>
      ) : (
        <>
          {preview.items.slice(0, MAX_RECORDS).map((item) => {
            const threadId = item.url ? null : item.threadId;
            return (
              <View key={item.key}>
                {item.url ? (
                  <Link url={item.url} target="markdown-link">
                    {item.title}
                  </Link>
                ) : threadId ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => props.onOpenThread(threadId)}
                  >
                    <Title status={item.subtitle}>{item.title}</Title>
                  </Pressable>
                ) : (
                  <Title status={item.subtitle}>{item.title}</Title>
                )}
                {item.meta.length > 0 ? <Muted>{item.meta.join(" · ")}</Muted> : null}
                {item.body ? <Body lines={3}>{item.body}</Body> : null}
              </View>
            );
          })}
          {hidden > 0 ? <Muted>{gt("+{count} more", { count: hidden })}</Muted> : null}
        </>
      );
    }
    case "table": {
      const hidden = Math.max(0, preview.rows.length - MAX_TABLE_ROWS) + preview.more;
      // Narrow screens read a table best as one line per row.
      return preview.rows.length === 0 ? (
        <Muted>{gt("No rows.")}</Muted>
      ) : (
        <>
          <Text className="font-mono text-2xs text-foreground-muted">
            {preview.columns.join(" · ")}
          </Text>
          {preview.rows.slice(0, MAX_TABLE_ROWS).map((row, index) => (
            <Text
              // Rows have no identity of their own and never reorder.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              selectable
              numberOfLines={2}
              className="font-mono text-2xs text-foreground"
            >
              {row.join(" · ")}
            </Text>
          ))}
          {hidden > 0 ? <Muted>{gt("+{count} more rows", { count: hidden })}</Muted> : null}
        </>
      );
    }
    case "document":
      return (
        <>
          {preview.title ? (
            preview.url ? (
              <Link url={preview.url} target="markdown-link">
                {preview.title}
              </Link>
            ) : (
              <Title>{preview.title}</Title>
            )
          ) : null}
          {preview.markdown ? (
            <Text
              selectable
              numberOfLines={12}
              className={cn(
                "text-xs leading-normal text-foreground",
                preview.preformatted && "font-mono text-2xs",
              )}
            >
              {preview.markdown}
            </Text>
          ) : null}
        </>
      );
    case "properties":
      return (
        <>
          {preview.title ? (
            preview.url ? (
              <Link url={preview.url} target="markdown-link">
                {preview.title}
              </Link>
            ) : (
              <Title>{preview.title}</Title>
            )
          ) : null}
          {preview.rows.map(([key, value]) => (
            <Text key={key} selectable numberOfLines={3} className="text-xs text-foreground">
              <Text className="text-foreground-muted">{`${key}  `}</Text>
              {value}
            </Text>
          ))}
        </>
      );
  }
}

const WEEKDAYS = [
  msg("Sun", { $context: "weekday abbreviation" }),
  msg("Mon", { $context: "weekday abbreviation" }),
  msg("Tue", { $context: "weekday abbreviation" }),
  msg("Wed", { $context: "weekday abbreviation" }),
  msg("Thu", { $context: "weekday abbreviation" }),
  msg("Fri", { $context: "weekday abbreviation" }),
  msg("Sat", { $context: "weekday abbreviation" }),
] as const;

function scheduleText(schedule: ScheduledTaskSchedule, resolve: MessageResolver = m): string {
  if (schedule.type === "once") return describeSchedule({ schedule }, undefined, resolve);
  if (schedule.type === "webhook") return resolve(msg("On webhook"));
  if (schedule.type === "interval") return formatScheduledTaskInterval(schedule.everyMs, resolve);
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? resolve(msg("Every day"))
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? resolve(msg("Weekdays"))
        : weekdays.map((day) => resolve(WEEKDAYS[day]!)).join(", ");
  return resolve(msg("{days} at {time}"), { days, time: schedule.timeOfDay });
}

function Muted(props: { readonly children: string; readonly className?: string }) {
  return (
    <Text selectable className={cn("text-2xs text-foreground-muted", props.className)}>
      {props.children}
    </Text>
  );
}

function Body(props: { readonly children: string; readonly lines?: number }) {
  return (
    <Text selectable numberOfLines={props.lines} className="text-xs leading-normal text-foreground">
      {props.children}
    </Text>
  );
}

function Title(props: { readonly children: string; readonly status?: string | null }) {
  return (
    <View className="flex-row items-start gap-2">
      <Text selectable className="flex-1 font-t3-medium text-xs text-foreground">
        {props.children}
      </Text>
      {props.status ? <Muted>{props.status.replaceAll("_", " ")}</Muted> : null}
    </View>
  );
}

function Link(props: {
  readonly url: string;
  readonly target: ExternalUrlTarget;
  readonly children: string;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void tryOpenExternalUrl(props.url, props.target)}
    >
      <Text numberOfLines={1} className="text-xs text-foreground underline">
        {props.children}
      </Text>
    </Pressable>
  );
}

function OpenThread(props: {
  readonly threadId: string | null;
  readonly onOpenThread: (threadId: string) => void;
  readonly label?: string;
}) {
  const { threadId } = props;
  const gt = useGT();
  if (!threadId) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="self-start rounded-md border border-border px-2 py-1"
      onPress={() => props.onOpenThread(threadId)}
    >
      <Text className="text-2xs text-foreground">{props.label ?? gt("Open thread")}</Text>
    </Pressable>
  );
}

function ProviderCapabilitiesView({
  preview,
}: {
  readonly preview: ProviderCapabilitiesToolPreview;
}) {
  const gt = useGT();
  const available = preview.providers.filter((provider) => !provider.unavailableReason);
  const unavailable = preview.providers.filter((provider) => provider.unavailableReason);
  const inherits = [
    preview.inheritedModel ? gt("Inherits {model}", { model: preview.inheritedModel }) : null,
    preview.inheritedProvider,
    ...preview.modes,
  ].filter(Boolean);
  return (
    <>
      {inherits.length > 0 ? <Muted>{inherits.join(" · ")}</Muted> : null}
      {available.length > 0 ? (
        <Muted className="uppercase">
          {gt("Available · {count}", { count: available.length })}
        </Muted>
      ) : null}
      {available.map((provider) => (
        <View key={provider.key} className="flex-row items-start gap-2">
          <View className="mt-1.5 size-1.5 rounded-full bg-adaptive-emerald-500" />
          <View className="flex-1">
            <Title
              status={provider.current ? gt("current", { $context: "provider in use" }) : null}
            >
              {provider.driver ? `${provider.name} · ${provider.driver}` : provider.name}
            </Title>
            {provider.models.length > 0 ? (
              <Text numberOfLines={1} className="text-2xs text-foreground-muted">
                {provider.models.join(", ")}
                {provider.modelCount > provider.models.length ? "…" : ""}
              </Text>
            ) : null}
          </View>
          <Muted>{String(provider.modelCount)}</Muted>
        </View>
      ))}
      {unavailable.length > 0 ? (
        <Muted className="uppercase">
          {gt("Unavailable · {count}", { count: unavailable.length })}
        </Muted>
      ) : null}
      {unavailable.map((provider) => (
        <View key={provider.key} className="flex-row items-center gap-2">
          <View className="size-1.5 rounded-full border border-foreground-muted" />
          <Muted>{provider.name}</Muted>
          <Text numberOfLines={1} className="flex-1 text-right text-2xs text-foreground-muted">
            {provider.unavailableReason}
          </Text>
        </View>
      ))}
    </>
  );
}

function PreviewBody(props: {
  readonly preview: ToolPreview;
  readonly onOpenThread: (threadId: string) => void;
  readonly renderSnapshotImage: (path: string) => ReactNode;
}) {
  const { preview } = props;
  const gt = useGT();
  const messages = useMessages();
  switch (preview.kind) {
    case "thread":
      return (
        <>
          <Title status={preview.status}>{preview.title}</Title>
          {preview.model || preview.branch ? (
            <Muted>{[preview.model, preview.branch].filter(Boolean).join(" · ")}</Muted>
          ) : null}
          {preview.moreItems > 0 ? (
            <Muted>{gt("+{count} earlier", { count: preview.moreItems })}</Muted>
          ) : null}
          {preview.items.map((item) => (
            <Body
              key={item.key}
              lines={item.activity ? 1 : 3}
            >{`${item.label}: ${item.text}`}</Body>
          ))}
          <OpenThread threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "task":
      return (
        <>
          <Title status={preview.status}>{preview.title ?? gt("Delegated task")}</Title>
          {preview.model ? <Muted>{preview.model}</Muted> : null}
          {preview.summary ? <Body lines={4}>{preview.summary}</Body> : null}
          <OpenThread threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "thread-action":
      return (
        <>
          <Title status={preview.status}>{preview.headline}</Title>
          {preview.details.map((detail) => (
            <Muted key={detail}>{detail}</Muted>
          ))}
          <OpenThread threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "thread-search":
      return (
        <>
          {preview.query ? (
            <Muted>
              {gt("“{query}” · {count} matches", {
                query: preview.query,
                count: preview.matches.length,
              })}
            </Muted>
          ) : null}
          {preview.matches.map((match) => (
            <Pressable
              key={`${match.threadId}\n${match.snippet}`}
              accessibilityRole="button"
              onPress={() => props.onOpenThread(match.threadId)}
            >
              <Body lines={2}>
                {match.source ? `${match.source}: ${match.snippet}` : match.snippet}
              </Body>
            </Pressable>
          ))}
        </>
      );
    case "context-transfers":
      return preview.transfers.length === 0 ? (
        <Muted>{gt("No context transfers.")}</Muted>
      ) : (
        <>
          {preview.transfers.map((transfer) => (
            <View key={transfer.id} className="flex-row items-center gap-2">
              <OpenThread
                threadId={transfer.sourceThreadId}
                onOpenThread={props.onOpenThread}
                label={gt("Source", { $context: "thread a context transfer came from" })}
              />
              <Muted>→</Muted>
              <OpenThread
                threadId={transfer.targetThreadId}
                onOpenThread={props.onOpenThread}
                label={gt("Target", { $context: "thread a context transfer went to" })}
              />
              {transfer.status ? <Muted>{transfer.status.replaceAll("_", " ")}</Muted> : null}
            </View>
          ))}
        </>
      );
    case "threads":
      return preview.threads.length === 0 ? (
        <Muted>{gt("No threads.")}</Muted>
      ) : (
        <>
          {preview.threads.map((thread) => (
            <Pressable key={thread.threadId} onPress={() => props.onOpenThread(thread.threadId)}>
              <Title status={thread.status}>{thread.title}</Title>
            </Pressable>
          ))}
        </>
      );
    case "scheduled-tasks":
      return preview.tasks.length === 0 ? (
        <Muted>{gt("No scheduled tasks.")}</Muted>
      ) : (
        <>
          {preview.tasks.map((task) => (
            <View key={task.id}>
              <Title>{task.title}</Title>
              <Muted>
                {[
                  task.schedule ? scheduleText(task.schedule, messages) : null,
                  task.enabled ? null : gt("paused", { $context: "automation status" }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Muted>
            </View>
          ))}
        </>
      );
    case "pull-requests":
      return preview.pullRequests.length === 0 ? (
        <Muted>{gt("No pull requests.")}</Muted>
      ) : (
        <>
          {preview.pullRequests.map((pr) => (
            <View key={pr.url}>
              <Link url={pr.url} target="pull-request">
                {pr.title ??
                  (pr.repository && pr.number ? `${pr.repository}#${pr.number}` : pr.url)}
              </Link>
              {pr.state || pr.headBranch || pr.note ? (
                <Muted>
                  {[
                    pr.state &&
                      (pr.isDraft ? gt("draft", { $context: "pull request state" }) : pr.state),
                    pr.headBranch,
                    pr.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Muted>
              ) : null}
            </View>
          ))}
        </>
      );
    case "browser":
      return (
        <>
          {preview.page ? (
            <Link url={preview.page.url} target="markdown-link">
              {preview.page.title ?? preview.page.url}
            </Link>
          ) : null}
          {preview.snapshot?.screenshotPath
            ? props.renderSnapshotImage(preview.snapshot.screenshotPath)
            : null}
          {preview.snapshot?.visibleText ? (
            <SnapshotText text={preview.snapshot.visibleText} />
          ) : null}
          {preview.target && preview.target !== preview.page?.url ? (
            <Text selectable className="font-mono text-2xs text-foreground">
              {preview.target}
            </Text>
          ) : null}
          {preview.text ? <Body>{`“${preview.text}”`}</Body> : null}
          {preview.detail ? <Body>{preview.detail}</Body> : null}
          {preview.expression ? (
            <Text selectable className="font-mono text-2xs leading-normal text-foreground">
              {preview.expression}
            </Text>
          ) : null}
          {preview.value !== null ? (
            <Text selectable className="font-mono text-2xs text-foreground-muted">
              {`→ ${preview.value}`}
            </Text>
          ) : null}
        </>
      );
    case "loaded-tools":
      return <Body>{preview.names.join(", ")}</Body>;
    case "slack-messages":
      if (preview.messages.length === 0) return <Muted>{gt("No messages found.")}</Muted>;
      return (
        <>
          {preview.messages.slice(0, MAX_SLACK_MESSAGES).map((message) => (
            <View
              key={`${message.time}\n${message.author}\n${message.text}`}
              className="border-l-2 border-border pl-2"
            >
              <Muted>
                {[message.author, message.channel, message.time].filter(Boolean).join(" · ")}
              </Muted>
              <Body lines={6}>{message.text}</Body>
            </View>
          ))}
          {preview.messages.length > MAX_SLACK_MESSAGES ? (
            <Muted>
              {gt("+{count} more", { count: preview.messages.length - MAX_SLACK_MESSAGES })}
            </Muted>
          ) : null}
        </>
      );
    case "questions":
      return (
        <>
          {preview.questions.map((question) => (
            <View key={question.question} className="gap-0.5">
              <Text selectable className="font-t3-medium text-xs text-foreground">
                {question.question}
              </Text>
              {question.options.map((option) => (
                <Text
                  key={option.label}
                  className={cn(
                    "text-xs",
                    option.selected ? "font-t3-medium text-foreground" : "text-foreground-muted",
                  )}
                >
                  {`${option.selected ? "●" : "○"} ${option.label}`}
                </Text>
              ))}
              {question.otherAnswer ? (
                <Body>{gt("Answered: {answer}", { answer: question.otherAnswer })}</Body>
              ) : null}
            </View>
          ))}
        </>
      );
    case "agent-message":
      return (
        <>
          {preview.recipient ? (
            <Muted>{gt("To {recipient}", { recipient: preview.recipient })}</Muted>
          ) : null}
          {preview.summary ? <Title>{preview.summary}</Title> : null}
          {preview.message ? <Body lines={8}>{preview.message}</Body> : null}
          <OpenThread threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "skill":
      return (
        <>
          <Text selectable className="font-mono text-2xs text-foreground">
            {`/${preview.skill}`}
          </Text>
          {preview.args ? <Body>{preview.args}</Body> : null}
        </>
      );
    case "monitor":
      return (
        <>
          {preview.description ? <Title>{preview.description}</Title> : null}
          <Text
            selectable
            numberOfLines={6}
            className="font-mono text-2xs leading-normal text-foreground-muted"
          >
            {preview.command}
          </Text>
        </>
      );
    case "wakeup":
      return (
        <>
          {preview.at ? (
            <Body>
              {gt("Wakes at {time}", {
                time: new Date(preview.at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
            </Body>
          ) : null}
          {preview.reason ? <Muted>{preview.reason}</Muted> : null}
          {preview.prompt ? <Body lines={4}>{preview.prompt}</Body> : null}
        </>
      );
    case "records":
    case "table":
    case "document":
    case "properties":
      return (
        <>
          <GenericHeader preview={preview} />
          <GenericBody preview={preview} onOpenThread={props.onOpenThread} />
        </>
      );
    case "provider-capabilities":
      return <ProviderCapabilitiesView preview={preview} />;
    case "html-page":
      return (
        <>
          {preview.title ? <Title>{preview.title}</Title> : null}
          {preview.details.length > 0 ? <Muted>{preview.details.join(" · ")}</Muted> : null}
        </>
      );
  }
}

function SnapshotText({ text }: { readonly text: string }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
      >
        <Muted>{expanded ? gt("Hide captured page text") : gt("Captured page text")}</Muted>
      </Pressable>
      {expanded ? <Body>{text}</Body> : null}
    </View>
  );
}

/** A tool call shown as what it did, the mobile counterpart of the web card. */
export function ToolPreviewCard(props: {
  readonly preview: ToolPreview;
  readonly renderSnapshotImage: (path: string) => ReactNode;
  readonly onOpenThread: (threadId: string) => void;
}) {
  return (
    <View className="gap-1.5">
      <PreviewBody {...props} />
    </View>
  );
}
