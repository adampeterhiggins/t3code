import type { ScheduledTaskSchedule } from "@t3tools/contracts";
import type { ToolPreview } from "@t3tools/client-runtime/work-log/tool-preview";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { tryOpenExternalUrl, type ExternalUrlTarget } from "../../lib/openExternalUrl";
import { formatScheduledTaskInterval } from "../settings/scheduledTaskPresentation";

const MAX_SLACK_MESSAGES = 5;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function scheduleText(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "webhook") return "On webhook";
  if (schedule.type === "interval") return formatScheduledTaskInterval(schedule.everyMs);
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? "Every day"
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? "Weekdays"
        : weekdays.map((day) => WEEKDAYS[day]).join(", ");
  return `${days} at ${schedule.timeOfDay}`;
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
}) {
  const { threadId } = props;
  if (!threadId) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="self-start rounded-md border border-border px-2 py-1"
      onPress={() => props.onOpenThread(threadId)}
    >
      <Text className="text-2xs text-foreground">Open thread</Text>
    </Pressable>
  );
}

function PreviewBody(props: {
  readonly preview: ToolPreview;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const { preview } = props;
  switch (preview.kind) {
    case "thread":
      return (
        <>
          <Title status={preview.status}>{preview.title}</Title>
          {preview.model || preview.branch ? (
            <Muted>{[preview.model, preview.branch].filter(Boolean).join(" · ")}</Muted>
          ) : null}
          {preview.items.map((item) => (
            <Body key={item.key} lines={3}>{`${item.label}: ${item.text}`}</Body>
          ))}
          {preview.moreItems > 0 ? <Muted>{`+${preview.moreItems} earlier`}</Muted> : null}
          <OpenThread threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "task":
      return (
        <>
          <Title status={preview.status}>{preview.title ?? "Delegated task"}</Title>
          {preview.model ? <Muted>{preview.model}</Muted> : null}
          {preview.summary ? <Body lines={4}>{preview.summary}</Body> : null}
          <OpenThread threadId={preview.threadId} onOpenThread={props.onOpenThread} />
        </>
      );
    case "threads":
      return preview.threads.length === 0 ? (
        <Muted>No threads.</Muted>
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
        <Muted>No scheduled tasks.</Muted>
      ) : (
        <>
          {preview.tasks.map((task) => (
            <View key={task.id}>
              <Title>{task.title}</Title>
              <Muted>
                {[
                  task.schedule ? scheduleText(task.schedule) : null,
                  task.enabled ? null : "paused",
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
        <Muted>No pull requests.</Muted>
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
                  {[pr.state && (pr.isDraft ? "draft" : pr.state), pr.headBranch, pr.note]
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
          {preview.target && preview.target !== preview.page?.url ? (
            <Text selectable className="font-mono text-2xs text-foreground">
              {preview.target}
            </Text>
          ) : null}
          {preview.text ? <Body>{`“${preview.text}”`}</Body> : null}
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
            <Muted>{`+${preview.messages.length - MAX_SLACK_MESSAGES} more`}</Muted>
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
              {question.otherAnswer ? <Body>{`Answered: ${question.otherAnswer}`}</Body> : null}
            </View>
          ))}
        </>
      );
    case "agent-message":
      return (
        <>
          {preview.recipient ? <Muted>{`To ${preview.recipient}`}</Muted> : null}
          {preview.summary ? <Title>{preview.summary}</Title> : null}
          <Body lines={8}>{preview.message}</Body>
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
            <Body>{`Wakes at ${new Date(preview.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</Body>
          ) : null}
          {preview.reason ? <Muted>{preview.reason}</Muted> : null}
          {preview.prompt ? <Body lines={4}>{preview.prompt}</Body> : null}
        </>
      );
    case "html-page":
      return (
        <>
          {preview.title ? <Title>{preview.title}</Title> : null}
          {preview.details.length > 0 ? <Muted>{preview.details.join(" · ")}</Muted> : null}
        </>
      );
  }
}

/** A tool call shown as what it did, the mobile counterpart of the web card. */
export function ToolPreviewCard(props: {
  readonly preview: ToolPreview;
  readonly onOpenThread: (threadId: string) => void;
}) {
  return (
    <View className="gap-1.5">
      <PreviewBody preview={props.preview} onOpenThread={props.onOpenThread} />
    </View>
  );
}
