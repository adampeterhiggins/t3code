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
  const head = [header, url, "", ...facts].join("\n");
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
