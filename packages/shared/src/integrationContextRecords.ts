import type {
  ComposerContextId,
  DiscordThreadContext,
  DiscordThreadContextRecord,
  GitHubIssueContext,
  GitHubIssueContextRecord,
  GitHubRefContext,
  GitHubRefContextRecord,
  GranolaNoteContext,
  GranolaNoteContextRecord,
  LinearIssueContext,
  LinearIssueContextRecord,
  LinearObjectContext,
  LinearObjectContextRecord,
  ModelContextOption,
  ModelContextRecord,
  NotionPageContext,
  NotionPageContextRecord,
  PromptLinkContextRecord,
  ProviderInstanceId,
  RepositoryContextRecord,
  SlackThreadContext,
  SlackThreadContextRecord,
  UnreadLinkContextRecord,
} from "@t3tools/contracts";

import {
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "./composerContextReferences.ts";
import { type ComposerObjectLink, composerObjectLinkChipLabel } from "./composerObjectLinks.ts";

/**
 * Chip records for integration objects, from the snapshot the server read. Shared so the
 * composer and agents attaching over MCP make the same record, with the same stable ids: the
 * same object attached twice in one message points both chips at one payload.
 */

export function linearIssueContextRecord(issue: LinearIssueContext): LinearIssueContextRecord {
  return {
    version: 1,
    kind: "linear-issue",
    // Linear issue ids are UUIDs, which already fit the context id pattern.
    contextId: `linear-issue_${issue.id}` as ComposerContextId,
    label: sanitizeComposerContextLabel(issue.identifier, "linear-issue"),
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title.slice(0, 2_048),
    url: issue.url,
    stateName: issue.stateName,
    markdown: issue.markdown,
  };
}

export function linearObjectContextRecord(object: LinearObjectContext): LinearObjectContextRecord {
  return {
    version: 1,
    kind: "linear-object",
    // Linear ids are UUIDs, which already fit the context id pattern.
    contextId: `linear-object_${object.id}` as ComposerContextId,
    label: sanitizeComposerContextLabel(object.title, "linear-object"),
    objectType: object.objectType,
    objectId: object.id,
    title: object.title.slice(0, 2_048),
    url: object.url.slice(0, 2_048),
    status: object.status?.slice(0, 2_048) ?? null,
    markdown: object.markdown,
  };
}

/** `#123`, the label an issue's chip and list rows show. */
export function gitHubIssueLabel(issue: { readonly number: number }): string {
  return `#${issue.number}`;
}

export function gitHubIssueContextRecord(issue: GitHubIssueContext): GitHubIssueContextRecord {
  const repository = issue.repository.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return {
    version: 1,
    kind: "github-issue",
    contextId: `github-issue_${repository}_${issue.number}`.slice(0, 128) as ComposerContextId,
    label: sanitizeComposerContextLabel(gitHubIssueLabel(issue), "github-issue"),
    repository: issue.repository,
    number: issue.number,
    title: issue.title.slice(0, 2_048),
    url: issue.url,
    state: issue.state,
    markdown: issue.markdown,
  };
}

/** `repo@v1.2.0`, `repo@main`, or `repo@abc1234`: the label a ref's chip shows. */
export function gitHubRefLabel(ref: {
  readonly repository: string;
  readonly refType: GitHubRefContext["refType"];
  readonly ref: string;
}): string {
  const name = ref.repository.split("/").at(-1) ?? ref.repository;
  return `${name}@${ref.refType === "commit" ? ref.ref.slice(0, 7) : ref.ref}`;
}

export function gitHubRefContextRecord(ref: GitHubRefContext): GitHubRefContextRecord {
  const id = `${ref.repository}_${ref.refType}_${ref.ref}`.toLowerCase();
  return {
    version: 1,
    kind: "github-ref",
    contextId: toKindScopedComposerContextId("github-ref", id),
    label: sanitizeComposerContextLabel(gitHubRefLabel(ref), "github-ref"),
    repository: ref.repository,
    refType: ref.refType,
    ref: ref.ref.slice(0, 255),
    title: ref.title.slice(0, 2_048),
    url: ref.url.slice(0, 2_048),
    sha: ref.sha,
    markdown: ref.markdown,
  };
}

export function slackThreadContextRecord(thread: SlackThreadContext): SlackThreadContextRecord {
  const id = `${thread.teamId}_${thread.channelId}_${thread.ts.replace(".", "-")}`;
  return {
    version: 1,
    kind: "slack-thread",
    contextId: `slack-${thread.scope}_${id}`.slice(0, 128) as ComposerContextId,
    label: sanitizeComposerContextLabel(
      `${thread.channelLabel} · ${thread.authorName}`,
      "slack-thread",
    ),
    teamId: thread.teamId,
    channelId: thread.channelId,
    channelLabel: thread.channelLabel.slice(0, 2_048),
    ts: thread.ts,
    threadTs: thread.threadTs,
    url: thread.url,
    authorName: thread.authorName.slice(0, 2_048),
    title: thread.title.slice(0, 2_048),
    replyCount: thread.replyCount,
    scope: thread.scope,
    markdown: thread.markdown,
  };
}

export function discordThreadContextRecord(
  thread: DiscordThreadContext,
): DiscordThreadContextRecord {
  return {
    version: 1,
    kind: "discord-thread",
    contextId:
      `discord-${thread.scope}_${thread.guildId}_${thread.channelId}_${thread.messageId}`.slice(
        0,
        128,
      ) as ComposerContextId,
    label: sanitizeComposerContextLabel(
      `${thread.channelLabel} · ${thread.authorName}`,
      "discord-thread",
    ),
    guildId: thread.guildId,
    channelId: thread.channelId,
    channelLabel: thread.channelLabel.slice(0, 2_048),
    messageId: thread.messageId,
    threadId: thread.threadId,
    url: thread.url,
    authorName: thread.authorName.slice(0, 2_048),
    title: thread.title.slice(0, 2_048),
    replyCount: thread.replyCount,
    scope: thread.scope,
    markdown: thread.markdown,
  };
}

export function notionPageContextRecord(page: NotionPageContext): NotionPageContextRecord {
  return {
    version: 1,
    kind: "notion-page",
    contextId: `notion-page_${page.id}` as ComposerContextId,
    label: sanitizeComposerContextLabel(page.title, "notion-page"),
    pageId: page.id,
    title: page.title.slice(0, 2048),
    url: page.url.slice(0, 2048),
    markdown: page.markdown,
  };
}

export function granolaNoteContextRecord(note: GranolaNoteContext): GranolaNoteContextRecord {
  return {
    version: 1,
    kind: "granola-note",
    // Meeting UUIDs and `not_` ids both fit the context id pattern.
    contextId: `granola-note_${note.id}` as ComposerContextId,
    label: sanitizeComposerContextLabel(note.title, "granola-note"),
    noteId: note.id,
    title: note.title.slice(0, 2048),
    url: note.url.slice(0, 2048),
    meetingAt: note.meetingAt?.slice(0, 2048) ?? null,
    participants: note.participants.join(", ").slice(0, 2048),
    markdown: note.markdown,
  };
}

/** The chip record for one repository to clone into the workspace's context folder. */
export function repositoryContextRecord(input: {
  readonly nameWithOwner: string;
  readonly remoteUrl: string;
}): RepositoryContextRecord {
  const nameWithOwner = input.nameWithOwner.trim().slice(0, 255);
  const slug = nameWithOwner
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  const repositoryName = nameWithOwner.split("/").at(-1) ?? nameWithOwner;
  const directoryName = repositoryName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+$/, "repo");
  return {
    version: 1,
    kind: "repository",
    contextId: `repository_${slug || "repo"}` as ComposerContextId,
    label: nameWithOwner.slice(0, 200),
    nameWithOwner,
    remoteUrl: input.remoteUrl,
    directoryName: directoryName || "repo",
  };
}

// FNV-1a, so the same link pasted twice in one message shares one payload.
function urlDigest(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index++) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The chip record for a T3 Code prompt link, labelled with the start of its prompt. */
export function promptLinkContextRecord(link: {
  readonly url: string;
  readonly prompt: string | null;
  readonly target: string | null;
}): PromptLinkContextRecord {
  const firstLine = link.prompt
    ?.split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();
  const label =
    firstLine === undefined
      ? `T3 Code prompt${link.target === null ? "" : ` for ${link.target}`}`
      : firstLine.length > 60
        ? `${firstLine.slice(0, 59).trimEnd()}…`
        : firstLine;
  return {
    version: 1,
    kind: "prompt-link",
    contextId: `prompt-link_${urlDigest(link.url)}` as ComposerContextId,
    label: sanitizeComposerContextLabel(label, "prompt-link"),
    url: link.url,
    prompt: link.prompt,
    target: link.target?.slice(0, 2048) ?? null,
  };
}

/** A link the composer tried to attach and could not read: its chip says so, and keeps the link. */
export function unreadLinkContextRecord(
  link: Pick<ComposerObjectLink, "kind" | "url">,
  reason: UnreadLinkContextRecord["reason"],
): UnreadLinkContextRecord {
  return {
    version: 1,
    kind: "unread-link",
    contextId: toKindScopedComposerContextId("unread-link", link.url),
    label: sanitizeComposerContextLabel(composerObjectLinkChipLabel(link), "unread-link"),
    url: link.url.slice(0, 2_048),
    linkKind: link.kind,
    reason,
  };
}

/** Fork: a model chip. `chipId` keeps each chip's record apart so one can be edited alone. */
export function modelContextRecord(input: {
  readonly chipId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly driver: string;
  readonly instanceName: string;
  readonly model: string;
  readonly modelName: string;
  readonly options: ReadonlyArray<ModelContextOption>;
  readonly writtenAt: string;
}): ModelContextRecord {
  return {
    version: 1,
    kind: "model",
    contextId: toKindScopedComposerContextId("model", input.chipId),
    label: sanitizeComposerContextLabel(input.modelName, "model"),
    providerInstanceId: input.providerInstanceId,
    driver: input.driver.slice(0, 64),
    instanceName: input.instanceName.slice(0, 2_048),
    model: input.model.slice(0, 255),
    modelName: input.modelName.slice(0, 2_048),
    options: input.options.slice(0, 32),
    writtenAt: input.writtenAt,
  };
}
