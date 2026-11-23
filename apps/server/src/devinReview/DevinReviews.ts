import {
  DEVIN_REVIEW_MARKDOWN_MAX_CHARS,
  type DevinReviewContext,
  DevinReviewError,
  type DevinReviewFinding,
  type DevinReviewGetInput,
  type DevinReviewListInput,
  type DevinReviewListResult,
  type DevinReviewProgress,
  type DevinReviewPullRequestRef,
  type DevinReviewStatus,
  type DevinReviewSummariesInput,
  type DevinReviewStatusSnapshot,
  type DevinReviewSummariesResult,
  type DevinReviewSummary,
  devinReviewPullRequestUrl,
  devinReviewUrl,
  parseDevinReviewUrl,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";

import { GitHubCli, type GitHubCliError } from "../sourceControl/GitHubCli.ts";
import { DevinReviewAuth } from "./DevinReviewAuth.ts";
import { type PrReviewResponse, devinPrReviewRequest } from "./devinReviewApi.ts";
import {
  type GitHubReviewThread,
  type JobVersionRef,
  combineFindings,
  fetchJobProgress,
  fetchJobResult,
  fetchReviewJobs,
  githubFinding,
  latestFindings,
  reviewRuns,
  runningJob,
  selectJobResults,
} from "./devinReviewJobs.ts";
import {
  isDevinReviewAuthor,
  isOpenFinding,
  parseDevinReviewComment,
  renderDevinReviewMarkdown,
} from "./devinReviewMarkdown.ts";

const LIST_LIMIT = 30;
const STATUS_CONCURRENCY = 4;
/** The sidebar refreshes often; Devin's status changes on the scale of minutes. */
const STATUS_TTL = Duration.seconds(60);
// A review in flight is re-read sooner, so clients watching it see it finish.
const IN_FLIGHT_STATUS_TTL = Duration.seconds(10);
const JOB_RESULT_CONCURRENCY = 3;
/**
 * A finished job result never changes, so only the count of cached ones is bounded. Lists read
 * up to six results for each of 30 pull requests.
 */
const JOB_RESULT_CAPACITY = 256;
const APP_API_TIMEOUT = Duration.seconds(15);
/** As often as Devin's own review page polls a running review's progress. */
const PROGRESS_POLL_INTERVAL = Duration.seconds(2);

const THREADS_FIELDS = `reviewThreads(first: 100) {
  nodes { id isResolved isOutdated comments(first: 1) { nodes { author { login } url COMMENT_FIELDS } } }
}`;

const GET_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url
      ${THREADS_FIELDS.replace("COMMENT_FIELDS", "body path line startLine originalLine originalStartLine")}
    }
  }
}`;

const SEARCH_FIELDS = `nodes { ... on PullRequest {
  number title url updatedAt repository { nameWithOwner }
  ${THREADS_FIELDS.replace("COMMENT_FIELDS", "")}
} }`;

const SUMMARY_FIELDS = `number title url
${THREADS_FIELDS.replace("COMMENT_FIELDS", "")}`;

/** One aliased `repository { pullRequest }` per pull request, so a batch is one GraphQL call. */
const summariesQuery = (refs: ReadonlyArray<DevinReviewPullRequestRef>) => {
  const variables = refs.map((_, i) => `$o${i}: String!, $n${i}: String!, $p${i}: Int!`).join(", ");
  const fields = refs
    .map(
      (_, i) =>
        `r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { ${SUMMARY_FIELDS} } }`,
    )
    .join("\n");
  const args = refs.flatMap((ref, i) => {
    const [owner, name] = ref.repository.split("/") as [string, string];
    return ["-f", `o${i}=${owner}`, "-f", `n${i}=${name}`, "-F", `p${i}=${ref.number}`];
  });
  return { query: `query(${variables}) {\n${fields}\n}`, args };
};

const SEARCHES = {
  authored: "is:pr is:open archived:false author:@me sort:updated-desc",
  reviewing: "is:pr is:open archived:false review-requested:@me sort:updated-desc",
} as const;

const listQuery = (involvement: "authored" | "reviewing" | "all") => {
  const aliases = involvement === "all" ? (["authored", "reviewing"] as const) : [involvement];
  const variables = aliases.map((alias) => `$${alias}: String!`).join(", ");
  const searches = aliases
    .map(
      (alias) =>
        `${alias}: search(query: $${alias}, type: ISSUE, first: ${LIST_LIMIT}) { ${SEARCH_FIELDS} }`,
    )
    .join("\n");
  return { aliases, query: `query(${variables}) {\n${searches}\n}` };
};

const Author = Schema.NullishOr(Schema.Struct({ login: Schema.String }));
const NullableInt = Schema.optional(Schema.NullOr(Schema.Int));

const ThreadNodes = <C extends Schema.Top>(comment: C) =>
  Schema.Struct({
    nodes: Schema.Array(
      Schema.NullOr(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          isResolved: Schema.Boolean,
          isOutdated: Schema.Boolean,
          comments: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(comment)) }),
        }),
      ),
    ),
  });

const DetailComment = Schema.Struct({
  author: Author,
  body: Schema.String,
  url: Schema.String,
  path: Schema.optional(Schema.NullOr(Schema.String)),
  line: NullableInt,
  startLine: NullableInt,
  originalLine: NullableInt,
  originalStartLine: NullableInt,
});

const GetResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            number: Schema.Int,
            title: Schema.String,
            url: Schema.String,
            reviewThreads: ThreadNodes(DetailComment),
          }),
        ),
      }),
    ),
  }),
});
const decodeGetResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(GetResponse));

const SearchPullRequest = Schema.Struct({
  number: Schema.optional(Schema.Int),
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  reviewThreads: Schema.optional(
    ThreadNodes(Schema.Struct({ author: Author, url: Schema.optional(Schema.String) })),
  ),
});
const ListResponse = Schema.Struct({
  data: Schema.Record(
    Schema.String,
    Schema.Struct({ nodes: Schema.Array(Schema.NullOr(SearchPullRequest)) }),
  ),
});
const decodeListResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(ListResponse));

const SummariesResponse = Schema.Struct({
  data: Schema.Record(
    Schema.String,
    Schema.NullOr(Schema.Struct({ pullRequest: Schema.NullOr(SearchPullRequest) })),
  ),
});
const decodeSummariesResponse = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SummariesResponse),
);

/** Devin's threads with their state alone, which is all a count needs. */
const devinThreadStates = (
  pullRequest: typeof SearchPullRequest.Type,
): ReadonlyArray<GitHubReviewThread> =>
  (pullRequest.reviewThreads?.nodes ?? []).flatMap((thread) => {
    const comment = thread?.comments.nodes[0];
    if (thread == null || comment == null || !isDevinReviewAuthor(comment.author?.login)) {
      return [];
    }
    return [
      {
        id: thread.id ?? null,
        finding: parseDevinReviewComment({
          body: "",
          url: comment.url ?? "",
          path: null,
          line: null,
          startLine: null,
          originalLine: null,
          originalStartLine: null,
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
        }),
      },
    ];
  });

const countOf = (findings: ReadonlyArray<DevinReviewFinding>) => ({
  open: findings.filter(isOpenFinding).length,
  total: findings.length,
});

interface StatusSnapshot {
  readonly status: DevinReviewStatus;
  readonly commitSha: string | null;
  readonly statusAt: string | null;
}
const UNKNOWN_STATUS: StatusSnapshot = { status: "unknown", commitSha: null, statusAt: null };
const toStatus = (review: PrReviewResponse | null): StatusSnapshot =>
  review === null
    ? { status: "none", commitSha: null, statusAt: null }
    : { status: review.status, commitSha: review.commit_sha, statusAt: review.created_at };

const refKey = (ref: DevinReviewPullRequestRef) => `${ref.repository}#${ref.number}`;
const refFromKey = (key: string): DevinReviewPullRequestRef => {
  const at = key.lastIndexOf("#");
  return { repository: key.slice(0, at), number: Number(key.slice(at + 1)) };
};

function toGitHubError(error: GitHubCliError): DevinReviewError {
  switch (error._tag) {
    case "GitHubCliUnavailableError":
      return new DevinReviewError({
        reason: "github",
        detail: "GitHub CLI (`gh`) is required to read Devin Review findings.",
      });
    case "GitHubCliAuthenticationError":
      return new DevinReviewError({
        reason: "github",
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      });
    case "GitHubCliRateLimitError":
      return new DevinReviewError({
        reason: "rate-limited",
        detail: "GitHub's API rate limit is exhausted. Try again shortly.",
      });
    case "GitHubPullRequestNotFoundError":
      return new DevinReviewError({ reason: "not-found", detail: "Pull request not found." });
    default:
      return new DevinReviewError({
        reason: "github",
        detail: `Could not read the pull request from GitHub: ${error.message}`,
      });
  }
}

const decodeError = () =>
  new DevinReviewError({ reason: "github", detail: "GitHub returned unexpected JSON." });

export class DevinReviews extends Context.Service<
  DevinReviews,
  {
    /** The pull request's Devin status and findings, read from Devin and GitHub. */
    readonly get: (
      input: DevinReviewGetInput,
    ) => Effect.Effect<DevinReviewContext, DevinReviewError>;
    /** Open pull requests the `gh` account authored or was asked to review, newest first. */
    readonly list: (
      input: DevinReviewListInput,
    ) => Effect.Effect<DevinReviewListResult, DevinReviewError>;
    /** Status and counts for several pull requests, in input order, skipping unreadable ones. */
    readonly summaries: (
      input: DevinReviewSummariesInput,
    ) => Effect.Effect<DevinReviewSummariesResult, DevinReviewError>;
    /** Devin's current status for the pull request, without reading GitHub. */
    readonly status: (
      input: DevinReviewGetInput,
    ) => Effect.Effect<DevinReviewStatusSnapshot, DevinReviewError>;
    /** Asks Devin to review the pull request's head commit. */
    readonly trigger: (
      input: DevinReviewGetInput,
    ) => Effect.Effect<DevinReviewSummary, DevinReviewError>;
    /**
     * What Devin's reviewer is doing in the pull request's queued or running review, polled
     * while subscribed and emitted when it changes; null while none is running.
     */
    readonly progress: (
      input: DevinReviewGetInput,
    ) => Stream.Stream<DevinReviewProgress | null, DevinReviewError>;
  }
>()("t3/devinReview/DevinReviews") {}

/** @public */
export const make = Effect.gen(function* () {
  const gh = yield* GitHubCli;
  const auth = yield* DevinReviewAuth;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);

  const graphqlRaw = (query: string, variables: ReadonlyArray<string>) =>
    gh
      .execute({
        // The query names its repository, so the server's own directory is as good a cwd as any.
        cwd: process.cwd(),
        args: ["api", "graphql", "-f", `query=${query}`, ...variables],
      })
      .pipe(Effect.map((result) => result.stdout));
  const graphql = (query: string, variables: ReadonlyArray<string>) =>
    graphqlRaw(query, variables).pipe(Effect.mapError(toGitHubError));

  const callDevin = Effect.fn("devin_review.call")(function* (
    method: "GET" | "POST",
    ref: DevinReviewPullRequestRef,
  ) {
    const credentials = yield* auth.credentials;
    if (Option.isNone(credentials)) {
      return yield* new DevinReviewError({
        reason: "not-connected",
        detail: "Devin Review is not connected. Connect it in Settings → Integrations.",
      });
    }
    return yield* devinPrReviewRequest(credentials.value, method, ref).pipe(
      Effect.provide(services),
      Effect.tapError((error) => (error.reason === "revoked" ? auth.markRevoked : Effect.void)),
    );
  });

  const statusCache = yield* Cache.makeWith(
    (key: string) => callDevin("GET", refFromKey(key)).pipe(Effect.map(toStatus)),
    {
      capacity: 256,
      timeToLive: (exit) =>
        Exit.isSuccess(exit)
          ? exit.value.status === "pending" || exit.value.status === "running"
            ? IN_FLIGHT_STATUS_TTL
            : STATUS_TTL
          : Duration.zero,
    },
  );

  /** Findings stay readable without Devin, so a failed status reads as unknown. */
  const readStatus = (ref: DevinReviewPullRequestRef) =>
    auth.credentials.pipe(
      Effect.flatMap((credentials) =>
        Option.isNone(credentials)
          ? Effect.succeed(UNKNOWN_STATUS)
          : Cache.get(statusCache, refKey(ref)),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Could not read Devin Review status", { detail: error.detail }).pipe(
          Effect.as(UNKNOWN_STATUS),
        ),
      ),
    );

  // Devin's own review data needs the CLI login; with a service key, reads stop at GitHub and status.
  const appToken = auth.credentials.pipe(
    Effect.map((credentials) =>
      Option.isSome(credentials) && credentials.value.method === "devin-login"
        ? credentials.value.apiKey
        : null,
    ),
  );
  const requireAppToken = appToken.pipe(
    Effect.filterOrFail(
      (token) => token !== null,
      () => new DevinReviewError({ reason: "not-connected", detail: "No Devin login." }),
    ),
  );

  const jobsCache = yield* Cache.makeWith(
    (key: string) =>
      requireAppToken.pipe(
        Effect.flatMap((token) => fetchReviewJobs(token, refFromKey(key))),
        Effect.provide(services),
      ),
    {
      capacity: 256,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? STATUS_TTL : Duration.zero),
    },
  );
  const resultKey = (ref: DevinReviewPullRequestRef, version: JobVersionRef) =>
    `${refKey(ref)} ${version.jobId} ${version.versionId}`;
  const resultCache = yield* Cache.makeWith(
    (key: string) => {
      const [ref = "", jobId = "", versionId = ""] = key.split(" ");
      return requireAppToken.pipe(
        Effect.flatMap((token) => fetchJobResult(token, refFromKey(ref), { jobId, versionId })),
        Effect.provide(services),
      );
    },
    {
      capacity: JOB_RESULT_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    },
  );

  let enrichmentWarned = false;
  /**
   * Devin's walkthrough, runs, and findings, or why they cannot be read: without a Devin login,
   * or whenever any of it is unreadable, findings come from GitHub alone.
   */
  const readDevinReview = Effect.fn("devin_review.read_devin_review")(
    function* (ref: DevinReviewPullRequestRef) {
      const credentials = yield* auth.credentials;
      if (Option.isNone(credentials)) return { unavailable: "Devin Review is not connected" };
      if (credentials.value.method !== "devin-login") {
        return { unavailable: "Devin's findings need a Devin login, not a service key" };
      }
      const jobs = yield* Cache.get(jobsCache, refKey(ref));
      const { full, incremental } = selectJobResults(jobs);
      const results = yield* Effect.forEach(
        full === null ? incremental : [full, ...incremental],
        (version) => Cache.get(resultCache, resultKey(ref, version)),
        { concurrency: JOB_RESULT_CONCURRENCY },
      );
      enrichmentWarned = false;
      return {
        unavailable: null,
        walkthrough: full === null ? null : (results[0]?.walkthrough ?? null),
        runs: reviewRuns(jobs),
        findings: latestFindings(results),
      };
    },
    Effect.timeout(APP_API_TIMEOUT),
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (!enrichmentWarned) {
          enrichmentWarned = true;
          yield* Effect.logWarning("Could not read Devin's findings; showing GitHub's only", {
            detail: error.message,
          });
        }
        return { unavailable: "Devin's review API could not be read" };
      }),
    ),
  );

  const parseRef = (url: string) => {
    const ref = parseDevinReviewUrl(url, { acceptGitHub: true });
    return ref === null
      ? Effect.fail(
          new DevinReviewError({
            reason: "invalid-url",
            detail: `${url} is not a GitHub pull request or Devin Review link.`,
          }),
        )
      : Effect.succeed(ref);
  };

  const readPullRequest = Effect.fn("devin_review.read_pull_request")(function* (
    ref: DevinReviewPullRequestRef,
  ) {
    const [owner, name] = ref.repository.split("/") as [string, string];
    const raw = yield* graphql(GET_QUERY, [
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${ref.number}`,
    ]);
    const response = yield* decodeGetResponse(raw).pipe(Effect.mapError(decodeError));
    const pullRequest = response.data.repository?.pullRequest;
    if (pullRequest == null) {
      return yield* new DevinReviewError({
        reason: "not-found",
        detail: `${devinReviewPullRequestUrl(ref)} was not found.`,
      });
    }
    const threads = pullRequest.reviewThreads.nodes.flatMap((thread): GitHubReviewThread[] => {
      const comment = thread?.comments.nodes[0];
      if (thread == null || comment == null || !isDevinReviewAuthor(comment.author?.login)) {
        return [];
      }
      return [
        {
          id: thread.id ?? null,
          finding: parseDevinReviewComment({
            body: comment.body,
            url: comment.url,
            path: comment.path ?? null,
            line: comment.line ?? null,
            startLine: comment.startLine ?? null,
            originalLine: comment.originalLine ?? null,
            originalStartLine: comment.originalStartLine ?? null,
            resolved: thread.isResolved,
            outdated: thread.isOutdated,
          }),
        },
      ];
    });
    return { title: pullRequest.title, url: pullRequest.url, threads };
  });

  /** Devin's findings with GitHub's thread state, or GitHub's alone when Devin's are unreadable. */
  const findingsOf = (
    ref: DevinReviewPullRequestRef,
    threads: ReadonlyArray<GitHubReviewThread>,
    review: Effect.Success<ReturnType<typeof readDevinReview>>,
  ) => {
    if (review.unavailable !== null) {
      return {
        review: null,
        githubOnlyReason: review.unavailable,
        findings: threads.map(githubFinding),
      };
    }
    return {
      review,
      githubOnlyReason: null,
      findings: combineFindings(review.findings, threads, devinReviewUrl(ref)),
    };
  };

  const summaryOf = (
    ref: DevinReviewPullRequestRef,
    pullRequest: { readonly title: string; readonly url: string },
    status: StatusSnapshot,
    counts: { readonly open: number; readonly total: number },
  ): DevinReviewSummary => ({
    repository: ref.repository,
    number: ref.number,
    title: pullRequest.title,
    pullRequestUrl: pullRequest.url,
    reviewUrl: devinReviewUrl(ref),
    status: status.status,
    commitSha: status.commitSha,
    statusAt: status.statusAt,
    openFindingCount: counts.open,
    findingCount: counts.total,
  });

  /** A list row: Devin's status, and counts of Devin's findings with GitHub's thread state. */
  const readSummary = (
    ref: DevinReviewPullRequestRef,
    pullRequest: {
      readonly title: string;
      readonly url: string;
      readonly threads: ReadonlyArray<GitHubReviewThread>;
    },
  ) =>
    Effect.all([readStatus(ref), readDevinReview(ref)], { concurrency: 2 }).pipe(
      Effect.map(([status, review]) =>
        summaryOf(
          ref,
          pullRequest,
          status,
          countOf(findingsOf(ref, pullRequest.threads, review).findings),
        ),
      ),
    );

  const get = Effect.fn("devin_review.get")(function* (input: DevinReviewGetInput) {
    const ref = yield* parseRef(input.url);
    const [pullRequest, status, devinReview] = yield* Effect.all(
      [readPullRequest(ref), readStatus(ref), readDevinReview(ref)],
      { concurrency: 3 },
    );
    const { review, githubOnlyReason, findings } = findingsOf(
      ref,
      pullRequest.threads,
      devinReview,
    );
    const summary = summaryOf(ref, pullRequest, status, countOf(findings));
    const walkthrough = review?.walkthrough ?? null;
    return {
      ...summary,
      findings,
      walkthrough,
      runs: review?.runs ?? null,
      findingsSource: review === null ? "github" : "devin",
      markdown: renderDevinReviewMarkdown(summary, findings, DEVIN_REVIEW_MARKDOWN_MAX_CHARS, {
        walkthrough,
        githubOnlyReason,
      }),
    } satisfies DevinReviewContext;
  });

  const list = Effect.fn("devin_review.list")(function* (input: DevinReviewListInput) {
    const { aliases, query } = listQuery(input.involvement ?? "all");
    const raw = yield* graphql(
      query,
      aliases.flatMap((alias) => ["-f", `${alias}=${SEARCHES[alias]}`]),
    );
    const response = yield* decodeListResponse(raw).pipe(Effect.mapError(decodeError));
    const seen = new Set<string>();
    const pullRequests = Object.values(response.data)
      .flatMap((search) => search.nodes)
      .flatMap((node) => {
        if (node?.url === undefined) return [];
        const ref = parseDevinReviewUrl(node.url, { acceptGitHub: true });
        if (ref === null || seen.has(refKey(ref))) return [];
        seen.add(refKey(ref));
        return [
          {
            ref,
            title: node.title ?? "",
            url: node.url,
            updatedAt: node.updatedAt ?? "",
            threads: devinThreadStates(node),
          },
        ];
      })
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, LIST_LIMIT);
    const reviews = yield* Effect.forEach(
      pullRequests,
      (pullRequest) => readSummary(pullRequest.ref, pullRequest),
      { concurrency: STATUS_CONCURRENCY },
    );
    return { reviews } satisfies DevinReviewListResult;
  });

  const readSummaryBatch = (refs: ReadonlyArray<DevinReviewPullRequestRef>) => {
    const { query, args } = summariesQuery(refs);
    return graphqlRaw(query, args).pipe(
      Effect.flatMap((raw) => decodeSummariesResponse(raw).pipe(Effect.mapError(decodeError))),
      Effect.map((response) =>
        refs.map((_, index) => {
          const pullRequest = response.data[`r${index}`]?.pullRequest;
          return pullRequest?.url === undefined
            ? null
            : {
                title: pullRequest.title ?? "",
                url: pullRequest.url,
                threads: devinThreadStates(pullRequest),
              };
        }),
      ),
    );
  };

  const readSummaryPullRequests = (refs: ReadonlyArray<DevinReviewPullRequestRef>) =>
    readSummaryBatch(refs).pipe(
      // GraphQL fails the whole batch when one pull request cannot be resolved, so read them one
      // at a time to leave out only that one.
      Effect.catchIf(
        (error) =>
          error._tag === "GitHubPullRequestNotFoundError" || error._tag === "GitHubCliCommandError",
        () =>
          refs.length === 1
            ? Effect.succeed([null])
            : Effect.forEach(
                refs,
                (ref) =>
                  readSummaryBatch([ref]).pipe(
                    Effect.map((pullRequests) => pullRequests[0] ?? null),
                    Effect.orElseSucceed(() => null),
                  ),
                { concurrency: STATUS_CONCURRENCY },
              ),
      ),
      Effect.mapError((error) =>
        error._tag === "DevinReviewError" ? error : toGitHubError(error),
      ),
    );

  const summaries = Effect.fn("devin_review.summaries")(function* (
    input: DevinReviewSummariesInput,
  ) {
    const seen = new Set<string>();
    const refs = input.urls.flatMap((url) => {
      const ref = parseDevinReviewUrl(url, { acceptGitHub: true });
      if (ref === null || seen.has(refKey(ref))) return [];
      seen.add(refKey(ref));
      return [ref];
    });
    if (refs.length === 0) return { reviews: [] } satisfies DevinReviewSummariesResult;
    const pullRequests = yield* readSummaryPullRequests(refs);
    const reviews = yield* Effect.forEach(
      refs,
      (ref, index) => {
        const pullRequest = pullRequests[index];
        return pullRequest == null
          ? Effect.succeed([])
          : readSummary(ref, pullRequest).pipe(Effect.map((summary) => [summary]));
      },
      { concurrency: STATUS_CONCURRENCY },
    );
    return { reviews: reviews.flat() } satisfies DevinReviewSummariesResult;
  });

  const trigger = Effect.fn("devin_review.trigger")(function* (input: DevinReviewGetInput) {
    const ref = yield* parseRef(input.url);
    const [review, pullRequest, devinReview] = yield* Effect.all(
      [callDevin("POST", ref), readPullRequest(ref), readDevinReview(ref)],
      { concurrency: 3 },
    );
    // Devin's reply is its status for the new review, so every client reads it at once.
    yield* Cache.set(statusCache, refKey(ref), toStatus(review));
    const { findings } = findingsOf(ref, pullRequest.threads, devinReview);
    return summaryOf(ref, pullRequest, toStatus(review), countOf(findings));
  });

  const status = Effect.fn("devin_review.status")(function* (input: DevinReviewGetInput) {
    const ref = yield* parseRef(input.url);
    return yield* readStatus(ref);
  });

  const progress = (input: DevinReviewGetInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const ref = yield* parseRef(input.url);
        // A service key cannot read Devin's review jobs.
        if ((yield* appToken) === null) return Stream.succeed<DevinReviewProgress | null>(null);
        let jobId: string | null = null;
        const poll = Effect.gen(function* () {
          const token = yield* requireAppToken;
          if (jobId === null) {
            jobId = runningJob(yield* fetchReviewJobs(token, ref))?.job_id ?? null;
            if (jobId === null) return null;
          }
          const current = yield* fetchJobProgress(token, ref, jobId);
          if (current.status !== "not_started" && current.status !== "running") {
            // The review finished: look for the next one, and let status and findings reads see it.
            jobId = null;
            yield* Cache.invalidate(statusCache, refKey(ref));
            yield* Cache.invalidate(jobsCache, refKey(ref));
          }
          return current;
        }).pipe(
          Effect.provide(services),
          Effect.timeout(APP_API_TIMEOUT),
          Effect.asSome,
          // One failed poll keeps the last progress on screen; the next poll tries again.
          Effect.catch((error) =>
            Effect.logDebug("Could not read Devin Review progress", { detail: error.message }).pipe(
              Effect.as(Option.none<DevinReviewProgress | null>()),
            ),
          ),
        );
        return Stream.tick(PROGRESS_POLL_INTERVAL).pipe(
          Stream.mapEffect(() => poll),
          Stream.filter(Option.isSome),
          Stream.map((value) => value.value),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );
      }),
    );

  return DevinReviews.of({ get, list, summaries, status, trigger, progress });
});

export const layer = Layer.effect(DevinReviews, make);
