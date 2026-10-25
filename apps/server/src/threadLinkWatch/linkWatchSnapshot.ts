// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type {
  ChatThreadMessage,
  DiscordThreadContext,
  GitHubIssueContext,
  GranolaNoteContext,
  LinearIssueContext,
  NotionPageContext,
  GoogleFileContext,
  OrchestrationV2Notification,
  SlackThreadContext,
  ThreadLinkKind,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const MESSAGES_LISTED = 10;
const EXCERPT_MAX_CHARS = 500;
const SUMMARY_MAX_CHARS = 120;
/** Wakes per watch. A busy conversation would otherwise wake the agent without end. */
export const THREAD_LINK_WATCH_WAKE_LIMIT = 20;

export interface SnapshotMessage {
  readonly key: string;
  readonly hash: string;
  readonly authorName: string;
  readonly postedAt: string;
  readonly text: string;
}

/** What a read of a linked object shows, reduced to what a watch compares. */
export interface LinkSnapshot {
  readonly title: string;
  /** Labelled values reported as a before and after when they change, such as a status. */
  readonly fields: Readonly<Record<string, string>>;
  readonly bodyHash: string;
  /** Slack and Discord report messages one by one; other kinds compare `bodyHash` alone. */
  readonly messages: ReadonlyArray<SnapshotMessage> | null;
  /** A closed issue ends its watch after the wake that says so. */
  readonly closed: boolean;
}

export const LinkBaseline = Schema.Struct({
  fields: Schema.Record(Schema.String, Schema.String),
  bodyHash: Schema.String,
  /** `[key, hash]` per message, or null for kinds without messages. */
  messages: Schema.NullOr(Schema.Array(Schema.Tuple([Schema.String, Schema.String]))),
});
export type LinkBaseline = typeof LinkBaseline.Type;

export const LinkBaselineJson = Schema.fromJsonString(LinkBaseline);

export const baselineOf = (snapshot: LinkSnapshot): LinkBaseline => ({
  fields: snapshot.fields,
  bodyHash: snapshot.bodyHash,
  messages:
    snapshot.messages === null
      ? null
      : snapshot.messages.map((message) => [message.key, message.hash] as const),
});

const hash = (text: string) =>
  NodeCrypto.createHash("sha256").update(text).digest("hex").slice(0, 32);

const chatMessages = (messages: ReadonlyArray<ChatThreadMessage>) =>
  messages.map((message) => ({
    // Snapshots carry no message ids; the author and time are stable across reads.
    key: `${message.postedAt} ${message.authorName}`,
    hash: hash(`${message.text}\n${message.files.join("\n")}`),
    authorName: message.authorName,
    postedAt: message.postedAt,
    text: message.text,
  }));

export const slackSnapshot = (context: SlackThreadContext): LinkSnapshot => ({
  title: context.title,
  fields: {},
  bodyHash: hash(context.markdown),
  messages: chatMessages(context.messages),
  closed: false,
});

export const discordSnapshot = (context: DiscordThreadContext): LinkSnapshot => ({
  title: context.title,
  fields: {},
  bodyHash: hash(context.markdown),
  messages: chatMessages(context.messages),
  closed: false,
});

export const linearSnapshot = (context: LinearIssueContext): LinkSnapshot => ({
  title: `${context.identifier} ${context.title}`,
  fields: {
    Title: context.title,
    Status: context.stateName,
    Assignee: context.assigneeName ?? "nobody",
    Priority: context.priorityLabel ?? "none",
  },
  bodyHash: hash(context.markdown),
  messages: null,
  closed: context.stateType === "completed" || context.stateType === "canceled",
});

export const gitHubSnapshot = (context: GitHubIssueContext): LinkSnapshot => ({
  title: `${context.repository}#${context.number} ${context.title}`,
  fields: {
    Title: context.title,
    State:
      context.stateReason === null
        ? context.state
        : `${context.state} (${context.stateReason.toLowerCase()})`,
    Assignees: context.assigneeLogins.length === 0 ? "nobody" : context.assigneeLogins.join(", "),
    Labels:
      context.labels.length === 0 ? "none" : context.labels.map((label) => label.name).join(", "),
  },
  bodyHash: hash(context.markdown),
  messages: null,
  closed: context.state === "closed",
});

export const notionSnapshot = (context: NotionPageContext): LinkSnapshot => ({
  title: context.title,
  fields: { Title: context.title },
  bodyHash: hash(context.markdown),
  messages: null,
  closed: false,
});
export const googleSnapshot = (context: GoogleFileContext): LinkSnapshot => ({
  title: context.title,
  fields: { Title: context.title },
  bodyHash: hash(`${context.revision ?? context.updatedAt}\n${context.markdown}`),
  messages: null,
  closed: false,
});

export const granolaSnapshot = (context: GranolaNoteContext): LinkSnapshot => ({
  title: context.title,
  fields: { Title: context.title },
  bodyHash: hash(context.markdown),
  messages: null,
  closed: false,
});

export interface LinkChange {
  readonly fields: ReadonlyArray<{
    readonly label: string;
    readonly from: string;
    readonly to: string;
  }>;
  readonly newMessages: ReadonlyArray<SnapshotMessage>;
  readonly editedMessages: number;
  /** Set for kinds without messages, whose content is compared as a whole. */
  readonly bodyChanged: boolean;
}

/** What changed since the thread was last told, or null when nothing it would care about did. */
export function diffLinkSnapshot(
  baseline: LinkBaseline,
  snapshot: LinkSnapshot,
): LinkChange | null {
  const fields = Object.entries(snapshot.fields).flatMap(([label, to]) => {
    const from = baseline.fields[label];
    return from === undefined || from === to ? [] : [{ label, from, to }];
  });
  let newMessages: Array<SnapshotMessage> = [];
  let editedMessages = 0;
  let bodyChanged = false;
  if (snapshot.messages !== null) {
    const known = new Map(baseline.messages ?? []);
    newMessages = snapshot.messages
      .filter((message) => !known.has(message.key))
      .toSorted((left, right) => left.postedAt.localeCompare(right.postedAt));
    editedMessages = snapshot.messages.filter((message) => {
      const before = known.get(message.key);
      return before !== undefined && before !== message.hash;
    }).length;
  } else {
    bodyChanged = baseline.bodyHash !== snapshot.bodyHash;
  }
  return fields.length === 0 && newMessages.length === 0 && editedMessages === 0 && !bodyChanged
    ? null
    : { fields, newMessages, editedMessages, bodyChanged };
}

export const THREAD_LINK_KIND_LABELS: Record<ThreadLinkKind, string> = {
  linear: "Linear issue",
  github: "GitHub issue",
  slack: "Slack thread",
  discord: "Discord thread",
  notion: "Notion page",
  google: "Google page",
  granola: "Granola note",
};

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export type LinkWatchOutcome = "watching" | "closed" | "limit";

/** The message that wakes the agent, and its notification. */
export function linkWatchMessage(input: {
  readonly kind: ThreadLinkKind;
  readonly url: string;
  readonly snapshot: LinkSnapshot;
  readonly change: LinkChange;
  readonly outcome: LinkWatchOutcome;
}): { readonly text: string; readonly notification: OrchestrationV2Notification } {
  const { change, snapshot } = input;
  const label = THREAD_LINK_KIND_LABELS[input.kind];
  const lines = [
    `Update on the ${label} "${clip(snapshot.title, 200)}" (${input.url}), which T3 Code is watching for you:`,
  ];
  for (const field of change.fields) {
    lines.push(`- ${field.label}: ${field.from} → ${field.to}`);
  }
  if (change.newMessages.length > 0) {
    lines.push(`- ${plural(change.newMessages.length, "new message", "new messages")}:`);
    for (const message of change.newMessages.slice(-MESSAGES_LISTED)) {
      lines.push(
        `  - ${message.authorName} at ${message.postedAt}: ${clip(message.text, EXCERPT_MAX_CHARS)}`,
      );
    }
    if (change.newMessages.length > MESSAGES_LISTED) {
      lines.push(
        `  - and ${change.newMessages.length - MESSAGES_LISTED} earlier ones not shown here.`,
      );
    }
  }
  if (change.editedMessages > 0) {
    lines.push(
      `- ${plural(change.editedMessages, "message was", "messages were")} edited or had files changed.`,
    );
  }
  if (change.bodyChanged) {
    lines.push(
      change.fields.length === 0
        ? "- Its content changed (description, comments, or other details)."
        : "- Its content may have changed too.",
    );
  }
  lines.push(
    "",
    `Read it with read_context_link for the full ${label} before acting on it.`,
    input.outcome === "closed"
      ? `It is closed, so T3 Code stopped watching it. Call watch_thread_link to watch it again.`
      : input.outcome === "limit"
        ? `T3 Code stopped watching after ${THREAD_LINK_WATCH_WAKE_LIMIT} updates. Call watch_thread_link to watch it again.`
        : "Act on it as your task requires. T3 Code keeps watching and wakes you on the next change, so end your turn when you are done. When the work no longer needs it, call unwatch_thread_link.",
  );

  const summary = [
    ...change.fields.map((field) => `${field.label} → ${field.to}`),
    ...(change.newMessages.length > 0
      ? [plural(change.newMessages.length, "new message", "new messages")]
      : []),
    ...(change.editedMessages > 0 ? [plural(change.editedMessages, "edit", "edits")] : []),
    ...(change.bodyChanged && change.fields.length === 0 ? ["edited"] : []),
  ].join(", ");
  return {
    text: lines.join("\n"),
    notification: {
      source: { kind: "monitor", linkUrl: input.url },
      outcome: "updated",
      summary: clip(`${label} ${snapshot.title}: ${summary}`, SUMMARY_MAX_CHARS),
    },
  };
}

/** The message that tells the agent a watch ended because the link could not be read. */
export function linkWatchUnreadableMessage(input: {
  readonly kind: ThreadLinkKind;
  readonly url: string;
  readonly failures: number;
  readonly detail: string;
}): { readonly text: string; readonly notification: OrchestrationV2Notification } {
  const label = THREAD_LINK_KIND_LABELS[input.kind];
  return {
    text: `T3 Code stopped watching the ${label} ${input.url} because it failed to read it ${input.failures} times in a row (${clip(input.detail, 300)}). Check it yourself, and call watch_thread_link to watch it again.`,
    notification: {
      source: { kind: "monitor", linkUrl: input.url },
      outcome: "failed",
      summary: clip(`${label}: stopped watching, could not read it`, SUMMARY_MAX_CHARS),
    },
  };
}
