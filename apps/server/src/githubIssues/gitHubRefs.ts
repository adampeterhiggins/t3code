import type { GitHubRefContext, GitHubRefLink, GitHubRefType } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { truncate } from "../issueMarkdown.ts";

/**
 * One query answers every kind of ref link: each field is null when the repository has no such
 * release, branch, tag, or commit, so a missing ref never needs a 404 told apart from a failure.
 */
export const GITHUB_REF_QUERY = `
fragment RefCommit on Commit {
  oid
  messageHeadline
  message
  committedDate
  additions
  deletions
  changedFilesIfAvailable
  author { name user { login } }
}
query($owner: String!, $name: String!, $ref: String!, $branchRef: String!, $tagRef: String!) {
  repository(owner: $owner, name: $name) {
    release(tagName: $ref) {
      name
      tagName
      description
      isPrerelease
      publishedAt
      createdAt
      author { login }
      tagCommit { ...RefCommit }
    }
    branch: ref(qualifiedName: $branchRef) { target { ...RefCommit } }
    tag: ref(qualifiedName: $tagRef) { target { ...RefCommit ... on Tag { target { ...RefCommit } } } }
    object(expression: $ref) { ...RefCommit }
  }
}`;

const CommitJson = Schema.Struct({
  oid: Schema.String,
  messageHeadline: Schema.String,
  message: Schema.String,
  committedDate: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFilesIfAvailable: Schema.NullishOr(Schema.Int),
  author: Schema.NullishOr(
    Schema.Struct({
      name: Schema.NullishOr(Schema.String),
      user: Schema.NullishOr(Schema.Struct({ login: Schema.String })),
    }),
  ),
});
type CommitJson = typeof CommitJson.Type;

// A ref's target is any git object. Only a commit, or an annotated tag pointing at one, matches
// the fragments; `commitOf` reads which it is.
const RefJson = Schema.NullishOr(Schema.Struct({ target: Schema.Unknown }));

const RepositoryJson = Schema.Struct({
  release: Schema.NullishOr(
    Schema.Struct({
      name: Schema.NullishOr(Schema.String),
      tagName: Schema.String,
      description: Schema.NullishOr(Schema.String),
      isPrerelease: Schema.Boolean,
      publishedAt: Schema.NullishOr(Schema.String),
      createdAt: Schema.String,
      author: Schema.NullishOr(Schema.Struct({ login: Schema.String })),
      tagCommit: Schema.NullishOr(CommitJson),
    }),
  ),
  branch: RefJson,
  tag: RefJson,
  object: Schema.Unknown,
});

export const GitHubRefResponse = Schema.Struct({
  data: Schema.Struct({ repository: Schema.NullishOr(RepositoryJson) }),
});
type RepositoryJson = typeof RepositoryJson.Type;

const decodeCommit = Schema.decodeUnknownOption(CommitJson);

/** The commit a ref target names, following an annotated tag to the commit it points at. */
function commitOf(target: unknown): CommitJson | null {
  const commit = decodeCommit(target);
  if (commit._tag === "Some") return commit.value;
  if (typeof target === "object" && target !== null && "target" in target) {
    const inner = decodeCommit(target.target);
    if (inner._tag === "Some") return inner.value;
  }
  return null;
}

function commitAuthor(commit: CommitJson): string | null {
  return commit.author?.user?.login ?? commit.author?.name ?? null;
}

function commitFacts(commit: CommitJson, label: string): string[] {
  const files = commit.changedFilesIfAvailable;
  const author = commitAuthor(commit);
  return [
    `${label}: ${commit.oid}`,
    ...(author === null ? [] : [`Author: ${author}`]),
    `Date: ${commit.committedDate}`,
    `Changes: ${files == null ? "" : `${files} file${files === 1 ? "" : "s"}, `}+${commit.additions} −${commit.deletions}`,
  ];
}

function render(header: string, url: string, facts: string[], body: string, maxChars: number) {
  const head = [header, url, "", ...facts.map((fact) => `- ${fact}`)].join("\n");
  const text = body.trim();
  return truncate(text.length === 0 ? head : `${head}\n\n${text}`, maxChars);
}

/**
 * What the link names, read from the query's answer, or null when the repository has nothing
 * by that name (including a `tree` link to a folder rather than a branch or tag).
 */
export function toGitHubRefContext(
  link: GitHubRefLink,
  url: string,
  repository: RepositoryJson,
  maxChars: number,
): GitHubRefContext | null {
  const release = link.linkType === "release" ? repository.release : null;
  if (release) {
    const commit = release.tagCommit ?? null;
    const title = release.name?.trim() || release.tagName;
    const date = release.publishedAt ?? release.createdAt;
    const facts = [
      `Tag: ${release.tagName}`,
      ...(commit === null ? [] : [`Commit: ${commit.oid}`]),
      ...(release.author ? [`Author: ${release.author.login}`] : []),
      `Published: ${date}`,
      ...(release.isPrerelease ? ["Pre-release"] : []),
    ];
    return {
      repository: link.repository,
      refType: "release",
      ref: release.tagName,
      title,
      url,
      sha: commit?.oid ?? null,
      authorLogin: release.author?.login ?? null,
      date,
      isPrerelease: release.isPrerelease,
      markdown: render(
        `# ${link.repository} release ${title}`,
        url,
        facts,
        release.description ?? "",
        maxChars,
      ),
    };
  }

  const resolved = ((): { refType: GitHubRefType; commit: CommitJson } | null => {
    if (link.linkType === "commit") {
      const commit = commitOf(repository.object);
      return commit === null ? null : { refType: "commit", commit };
    }
    const branch = link.linkType === "tree" ? commitOf(repository.branch?.target) : null;
    if (branch !== null) return { refType: "branch", commit: branch };
    // A release link whose tag has no release still names the tag.
    const tag = commitOf(repository.tag?.target);
    if (tag !== null) return { refType: "tag", commit: tag };
    const object = link.linkType === "tree" ? commitOf(repository.object) : null;
    return object !== null && object.oid.startsWith(link.ref.toLowerCase())
      ? { refType: "commit", commit: object }
      : null;
  })();
  if (resolved === null) return null;
  const { refType, commit } = resolved;
  const ref = refType === "commit" ? commit.oid : link.ref;
  const name = refType === "commit" ? commit.oid.slice(0, 7) : ref;
  return {
    repository: link.repository,
    refType,
    ref,
    title: commit.messageHeadline,
    url,
    sha: commit.oid,
    authorLogin: commitAuthor(commit),
    date: commit.committedDate,
    isPrerelease: false,
    markdown: render(
      `# ${link.repository} ${refType} ${name}`,
      url,
      commitFacts(commit, refType === "commit" ? "Commit" : "Head commit"),
      commit.message,
      maxChars,
    ),
  };
}

const StepJson = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullishOr(Schema.String),
});

export const GitHubActionsJob = Schema.Struct({
  id: Schema.Number,
  run_id: Schema.Number,
  name: Schema.String,
  workflow_name: Schema.NullishOr(Schema.String),
  html_url: Schema.NullishOr(Schema.String),
  status: Schema.String,
  conclusion: Schema.NullishOr(Schema.String),
  head_branch: Schema.NullishOr(Schema.String),
  head_sha: Schema.String,
  run_attempt: Schema.optional(Schema.Number),
  started_at: Schema.NullishOr(Schema.String),
  completed_at: Schema.NullishOr(Schema.String),
  steps: Schema.optional(Schema.Array(StepJson)),
});
type GitHubActionsJobJson = typeof GitHubActionsJob.Type;

export const GitHubActionsRun = Schema.Struct({
  id: Schema.Number,
  name: Schema.NullishOr(Schema.String),
  display_title: Schema.NullishOr(Schema.String),
  run_number: Schema.Number,
  run_attempt: Schema.optional(Schema.Number),
  event: Schema.String,
  status: Schema.NullishOr(Schema.String),
  conclusion: Schema.NullishOr(Schema.String),
  head_branch: Schema.NullishOr(Schema.String),
  head_sha: Schema.String,
  html_url: Schema.String,
  created_at: Schema.String,
  run_started_at: Schema.optional(Schema.NullishOr(Schema.String)),
  actor: Schema.NullishOr(Schema.Struct({ login: Schema.String })),
  pull_requests: Schema.optional(Schema.Array(Schema.Struct({ number: Schema.Number }))),
});
type GitHubActionsRunJson = typeof GitHubActionsRun.Type;

export const GitHubActionsRunJobs = Schema.Struct({ jobs: Schema.Array(GitHubActionsJob) });

/** `failure`, or `in_progress` while it has no conclusion yet. */
function outcome(item: {
  readonly status?: string | null | undefined;
  readonly conclusion?: string | null | undefined;
}): string {
  return (item.conclusion ?? item.status ?? "unknown").replaceAll("_", " ");
}

function failedSteps(job: GitHubActionsJobJson): string[] {
  return (job.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
}

function jobLine(job: GitHubActionsJobJson): string {
  const failed = failedSteps(job);
  const name = job.html_url ? `[${job.name}](${job.html_url})` : job.name;
  return `- ${name}: ${outcome(job)}${failed.length === 0 ? "" : ` (failed: ${failed.join(", ")})`}`;
}

/** A workflow run with the outcome of each of its jobs. */
export function toGitHubActionsRunContext(
  link: GitHubRefLink,
  url: string,
  run: GitHubActionsRunJson,
  jobs: ReadonlyArray<GitHubActionsJobJson>,
  maxChars: number,
): GitHubRefContext {
  const workflow = run.name?.trim() || "Workflow";
  const title = `${workflow} #${run.run_number}`;
  const date = run.run_started_at ?? run.created_at;
  const pullRequests = (run.pull_requests ?? []).map((pr) => `#${pr.number}`);
  const facts = [
    ...(run.display_title ? [`Title: ${run.display_title}`] : []),
    `Result: ${outcome(run)}`,
    `Event: ${run.event}`,
    ...(run.head_branch ? [`Branch: ${run.head_branch}`] : []),
    `Commit: ${run.head_sha}`,
    ...(pullRequests.length === 0 ? [] : [`Pull requests: ${pullRequests.join(", ")}`]),
    ...(run.actor ? [`Triggered by: ${run.actor.login}`] : []),
    ...((run.run_attempt ?? 1) > 1 ? [`Attempt: ${run.run_attempt}`] : []),
    `Started: ${date}`,
  ];
  const body = jobs.length === 0 ? "" : ["## Jobs", ...jobs.map(jobLine)].join("\n");
  return {
    repository: link.repository,
    refType: "workflow-run",
    ref: String(run.id),
    title,
    url,
    sha: run.head_sha,
    authorLogin: run.actor?.login ?? null,
    date,
    isPrerelease: false,
    markdown: render(`# ${link.repository} workflow run ${title}`, url, facts, body, maxChars),
  };
}

/** One job of a workflow run with the outcome of each of its steps. */
export function toGitHubActionsJobContext(
  link: GitHubRefLink,
  url: string,
  job: GitHubActionsJobJson,
  maxChars: number,
): GitHubRefContext {
  const title = job.workflow_name ? `${job.workflow_name} / ${job.name}` : job.name;
  const failed = failedSteps(job);
  const facts = [
    `Result: ${outcome(job)}`,
    ...(failed.length === 0 ? [] : [`Failed steps: ${failed.join(", ")}`]),
    ...(job.head_branch ? [`Branch: ${job.head_branch}`] : []),
    `Commit: ${job.head_sha}`,
    `Run: https://github.com/${link.repository}/actions/runs/${job.run_id}`,
    ...((job.run_attempt ?? 1) > 1 ? [`Attempt: ${job.run_attempt}`] : []),
    ...(job.started_at ? [`Started: ${job.started_at}`] : []),
    ...(job.completed_at ? [`Completed: ${job.completed_at}`] : []),
  ];
  const steps = job.steps ?? [];
  const body =
    steps.length === 0
      ? ""
      : ["## Steps", ...steps.map((step) => `- ${step.name}: ${outcome(step)}`)].join("\n");
  return {
    repository: link.repository,
    refType: "workflow-job",
    ref: String(job.id),
    title,
    url,
    sha: job.head_sha,
    authorLogin: null,
    date: job.started_at ?? null,
    isPrerelease: false,
    markdown: render(`# ${link.repository} workflow job ${title}`, url, facts, body, maxChars),
  };
}
