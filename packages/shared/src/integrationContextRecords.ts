import type {
  ComposerContextId,
  GitHubIssueContext,
  GitHubIssueContextRecord,
  LinearIssueContext,
  LinearIssueContextRecord,
  NotionPageContext,
  NotionPageContextRecord,
  RepositoryContextRecord,
  SlackThreadContext,
  SlackThreadContextRecord,
} from "@t3tools/contracts";

import { sanitizeComposerContextLabel } from "./composerContextReferences.ts";

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
