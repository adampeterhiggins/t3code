import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  SourceControlProviderKind,
  type PullRequestListEntry,
  type PullRequestListResult,
} from "@t3tools/contracts";
import {
  appendPullRequestListPage,
  DEFAULT_PR_LIST_CONTROLS,
  pullRequestListFacets,
  EMPTY_PULL_REQUEST_STATS_CACHE,
  filterPullRequestList,
  mergePullRequestListEntries,
  mergeEnvironmentPullRequestPages,
  nextPullRequestListInput,
  PR_LIST_PAGE_SIZE,
  patchPullRequestListEntry,
  pullRequestFilterChoices,
  pullRequestLabelColors,
  pullRequestListHead,
  pullRequestListInput,
  scopedPullRequestListKey,
  pullRequestLabelColor,
  shownPullRequestListPages,
  pullRequestListRowsAreEqual,
  withAnsweredPullRequestStats,
  withListedPullRequests,
  withShownPullRequestStats,
  withoutScratchProjectScope,
} from "./pullRequestList";

function entry(number: number, patch: Partial<PullRequestListEntry> = {}): PullRequestListEntry {
  return {
    number,
    provider: SourceControlProviderKind.make("github"),
    host: "github.com",
    repository: "org/repo",
    projectId: "project" as PullRequestListEntry["projectId"],
    projectTitle: "Project",
    title: `Change ${number}`,
    url: `https://github.com/org/repo/pull/${number}`,
    author: { login: "octocat", name: null, avatarUrl: null },
    headBranch: `branch-${number}`,
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "unknown",
    additions: 0,
    deletions: 0,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: `2026-10-${String(number).padStart(2, "0")}T00:00:00Z`,
    observedAt: 1,
    viewerReviewRequested: false,
    labels: [],
    ...patch,
  };
}
function page(
  entries: readonly PullRequestListEntry[],
  nextCursors: PullRequestListResult["nextCursors"] = {},
): PullRequestListResult {
  return {
    entries,
    nextCursors,
    truncated: Object.keys(nextCursors).length > 0,
    viewers: { "github.com": "octocat" },
    providers: [],
    errors: [],
  };
}

describe("recycled PR list rows", () => {
  const scopedEntry = (patch: Partial<PullRequestListEntry> = {}) => ({
    ...entry(1, patch),
    environmentId: EnvironmentId.make("env-one"),
  });

  it("updates navigation and commands when a duplicate moves to another environment", () => {
    const original = scopedEntry();
    expect(
      pullRequestListRowsAreEqual(original, {
        ...original,
        environmentId: EnvironmentId.make("env-two"),
      }),
    ).toBe(false);
  });
});

describe("mobile PR list pagination", () => {
  it("continues only the repositories that have more, preserving the query and filters", () => {
    const first = pullRequestListHead(
      null,
      page([entry(3)], { "github.com org/repo": "opaque-boundary" }),
    );
    expect(
      nextPullRequestListInput(first, {
        state: "open",
        query: "fix",
        filters: { draft: "hide" },
        limit: 30,
      }),
    ).toEqual({
      state: "open",
      query: "fix",
      filters: { draft: "hide" },
      limit: 30,
      cursors: { "github.com org/repo": "opaque-boundary" },
    });
    const next = appendPullRequestListPage(first, page([entry(2), entry(1)]), {
      state: "open",
      cursors: first.nextCursors,
    });
    expect(next.entries.map((row) => row.number)).toEqual([3, 2, 1]);
    expect(nextPullRequestListInput(next, { state: "open" })).toBeNull();
  });
  it("deduplicates page boundaries and never overwrites a fresh row with an older slice", () => {
    const current = entry(2, { title: "Retitled", observedAt: 20 });
    expect(
      mergePullRequestListEntries([current], [entry(2, { observedAt: 10 }), entry(1)]),
    ).toEqual([current, entry(1)]);
    expect(
      mergePullRequestListEntries([entry(1)], [entry(2, { host: "enterprise.test" }), entry(2)]),
    ).toHaveLength(3);
  });
  it("patches a row that only the list head supplies, and keeps it while that head is current", () => {
    const head = page([entry(2), entry(1)], { repo: "first" });
    const patched = patchPullRequestListEntry(null, head, entry(1), { state: "merged" }, 5);
    expect(shownPullRequestListPages(patched, head)?.entries.map((row) => row.state)).toEqual([
      "open",
      "merged",
    ]);
  });
  it("refreshes the head without dropping older loaded pages or rewinding their cursor", () => {
    const first = pullRequestListHead(null, page([entry(3)], { repo: "first" }));
    const continued = appendPullRequestListPage(first, page([entry(2)], { repo: "second" }), {
      state: "open",
      cursors: first.nextCursors,
    });
    const updated = pullRequestListHead(
      continued,
      page([entry(4), entry(3, { title: "New title", observedAt: 2 })], { repo: "first-new" }),
    );
    expect(updated.entries.map((row) => row.number)).toEqual([4, 3, 2]);
    expect(updated.entries[1]?.title).toBe("New title");
    expect(updated.nextCursors).toEqual({ repo: "second" });
    expect(pullRequestListHead(updated, updated.head)).toBe(updated);
  });
  it("can grow legacy listings that provide no cursor, without exceeding the wire limit", () => {
    const first = pullRequestListHead(null, { ...page([entry(1)]), truncated: true });
    expect(nextPullRequestListInput(first, { state: "all" })?.limit).toBe(60);
    expect(nextPullRequestListInput({ ...first, limit: 490 }, { state: "all" })?.limit).toBe(500);
    expect(nextPullRequestListInput({ ...first, limit: 500 }, { state: "all" })).toBeNull();
  });
});

describe("all-environment PR list", () => {
  const cups = EnvironmentId.make("cups");
  const mbp = EnvironmentId.make("mbp");
  it("combines independent pages, collapses duplicate PRs, and keeps their source for navigation", () => {
    const first = pullRequestListHead(null, page([entry(3), entry(1)], { repo: "cups-next" }));
    const second = pullRequestListHead(null, page([entry(2), entry(1)], { repo: "mbp-next" }));
    const merged = mergeEnvironmentPullRequestPages([
      { environmentId: cups, pages: first },
      { environmentId: mbp, pages: second },
    ]);
    const rows = filterPullRequestList(
      merged.entries,
      DEFAULT_PR_LIST_CONTROLS,
      merged.viewers,
      "",
      merged.localSearchHosts,
    );
    expect(rows.map((row) => [row.number, row.environmentId])).toEqual([
      [3, cups],
      [2, mbp],
      [1, cups],
    ]);
    expect(scopedPullRequestListKey(rows[1]!)).toBe("mbp:github.com:org/repo:2");
    expect(nextPullRequestListInput(first, { state: "open" })?.cursors).toEqual({
      repo: "cups-next",
    });
    expect(nextPullRequestListInput(second, { state: "open" })?.cursors).toEqual({
      repo: "mbp-next",
    });
    const continued = appendPullRequestListPage(first, page([entry(4)]), {
      state: "open",
      cursors: first.nextCursors,
    });
    expect(nextPullRequestListInput(continued, { state: "open" })).toBeNull();
    expect(nextPullRequestListInput(second, { state: "open" })?.cursors).toEqual({
      repo: "mbp-next",
    });
  });
  it("uses the viewer account and search support from each environment before deduplicating", () => {
    const remote = {
      ...page([entry(1, { author: { login: "other", name: null, avatarUrl: null } })]),
      viewers: { "github.com": "other" },
    };
    const local = page([entry(1), entry(2)]);
    const merged = mergeEnvironmentPullRequestPages([
      { environmentId: cups, pages: pullRequestListHead(null, remote) },
      { environmentId: mbp, pages: pullRequestListHead(null, local) },
    ]);
    const byMe = filterPullRequestList(
      merged.entries,
      { ...DEFAULT_PR_LIST_CONTROLS, involvement: "authored" },
      merged.viewers,
      "",
      merged.localSearchHosts,
    );
    expect(byMe.map((row) => [row.number, row.environmentId])).toEqual([
      [2, mbp],
      [1, cups],
    ]);
    const localOnlySearch = new Set([`${cups} github.com`]);
    const searched = filterPullRequestList(
      merged.entries,
      DEFAULT_PR_LIST_CONTROLS,
      merged.viewers,
      "body match",
      localOnlySearch,
    );
    expect(searched.map((row) => [row.number, row.environmentId])).toEqual([
      [2, mbp],
      [1, mbp],
    ]);
  });
  it("scopes a project to its owning environment even if another has the same project id", () => {
    const merged = mergeEnvironmentPullRequestPages([
      { environmentId: cups, pages: pullRequestListHead(null, page([entry(1)])) },
      { environmentId: mbp, pages: pullRequestListHead(null, page([entry(2)])) },
    ]);
    expect(
      filterPullRequestList(
        merged.entries,
        { ...DEFAULT_PR_LIST_CONTROLS, projectId: "project", projectEnvironmentId: mbp },
        merged.viewers,
        "",
        merged.localSearchHosts,
      ).map((row) => row.environmentId),
    ).toEqual([mbp]);
  });
});

describe("mobile PR scan and filters", () => {
  it("resolves authored and author:me per host rather than mixing account identities", () => {
    const rows = [entry(1), entry(2, { host: "enterprise.test" })];
    const viewers = { "github.com": "Octocat", "enterprise.test": "someone-else" };
    expect(
      filterPullRequestList(
        rows,
        { ...DEFAULT_PR_LIST_CONTROLS, involvement: "authored" },
        viewers,
        "",
        new Set(),
      ).map((row) => row.number),
    ).toEqual([1]);
    expect(
      filterPullRequestList(
        rows,
        { ...DEFAULT_PR_LIST_CONTROLS, filters: { author: "me" } },
        viewers,
        "",
        new Set(),
      ).map((row) => row.number),
    ).toEqual([1]);
    expect(
      filterPullRequestList(rows, DEFAULT_PR_LIST_CONTROLS, viewers, "author:@me", new Set()).map(
        (row) => row.number,
      ),
    ).toEqual([1]);
  });
  it("reads a typed draft qualifier as a filter and searches only the text left over", () => {
    expect(pullRequestListInput(DEFAULT_PR_LIST_CONTROLS, "draft:false fix")).toEqual({
      state: "open",
      involvement: "all",
      filters: { draft: "hide" },
      limit: PR_LIST_PAGE_SIZE,
      query: "fix",
    });
    const rows = [
      entry(1, { title: "Fix parser" }),
      entry(2, { title: "Fix drafts", isDraft: true }),
      entry(3),
    ];
    expect(
      filterPullRequestList(
        rows,
        DEFAULT_PR_LIST_CONTROLS,
        {},
        "draft:false fix",
        new Set(["github.com"]),
      ).map((row) => row.number),
    ).toEqual([1]);
  });
  it("does not label unsupported review summaries as reviewed or match text locally on host-search results", () => {
    expect(
      filterPullRequestList(
        [entry(1)],
        { ...DEFAULT_PR_LIST_CONTROLS, filters: { review: "approved" } },
        {},
        "body text",
        new Set(),
      ),
    ).toHaveLength(1);
    expect(
      filterPullRequestList(
        [entry(1)],
        DEFAULT_PR_LIST_CONTROLS,
        {},
        "body text",
        new Set(["github.com"]),
      ),
    ).toHaveLength(0);
  });
  it("lists a shared repository's row from a connected environment over an offline one", () => {
    const rows = [
      { ...entry(1), environmentId: "laptop" },
      { ...entry(1), environmentId: "server" },
    ];
    const pick = (connected: ReadonlySet<string>) =>
      filterPullRequestList(rows, DEFAULT_PR_LIST_CONTROLS, {}, "", new Set(), connected).map(
        (row) => row.environmentId,
      );
    expect(pick(new Set(["server"]))).toEqual(["server"]);
    expect(pick(new Set(["laptop", "server"]))).toEqual(["laptop"]);
    expect(pick(new Set())).toEqual(["laptop"]);
  });

  it("sorts loaded rows", () => {
    const rows = [
      entry(1, { labels: [{ name: "bug", color: null }] }),
      entry(2, {
        labels: [
          { name: "bug", color: null },
          { name: "feature", color: null },
        ],
      }),
    ];
    expect(
      filterPullRequestList(
        rows,
        { ...DEFAULT_PR_LIST_CONTROLS, sort: "oldest" },
        {},
        "",
        new Set(),
      ).map((row) => row.number),
    ).toEqual([1, 2]);
    expect(pullRequestLabelColor("ffab00")).toBe("#ffab00");
    expect(pullRequestLabelColor("not-a-color")).toBeNull();
  });
});

describe("pull request list facets", () => {
  const bug = { name: "bug", color: null };
  const docs = { name: "docs", color: null };
  const ada = { login: "ada", name: null, avatarUrl: null };
  const rows = [
    entry(1, { author: ada, labels: [bug] }),
    entry(2, { author: ada, labels: [docs], isDraft: true }),
    entry(3, { labels: [bug, docs], state: "merged" }),
    entry(4, { labels: [bug], viewerReviewRequested: true }),
  ];
  const facets = (controls: Partial<typeof DEFAULT_PR_LIST_CONTROLS>, entries = rows) =>
    pullRequestListFacets(
      entries,
      { ...DEFAULT_PR_LIST_CONTROLS, ...controls },
      { "github.com": "octocat" },
      "",
      new Set(),
    );
  const byValue = (choices: readonly { value: string; count: number }[]) =>
    Object.fromEntries(choices.map((choice) => [choice.value, choice.count]));

  it("counts each menu under the other filters but never its own", () => {
    const result = facets({ filters: { labels: [["bug"]], author: "ada" } });
    expect(byValue(result.labels)).toEqual({ bug: 1, docs: 1 });
    expect(byValue(result.authors)).toEqual({ ada: 1, octocat: 1 });
    expect(facets({ filters: { labels: [["bug"]] } }).state).toMatchObject({
      all: 3,
      open: 2,
      merged: 1,
    });
  });

  it("keeps a picked value the other filters exclude, at zero", () => {
    const result = facets({ filters: { labels: [["docs"]], draft: "hide" } });
    expect(byValue(result.labels)).toMatchObject({ docs: 0 });
    expect(byValue(facets({ filters: { author: "grace" } }).authors)).toMatchObject({ grace: 0 });
  });

  it("counts the fixed menus and the involvement the viewer has", () => {
    const result = facets({});
    expect(result.loaded).toBe(4);
    expect(result.draft).toMatchObject({ all: 3, only: 1, hide: 2 });
    expect(result.involvement).toMatchObject({ all: 3, reviewing: 1, authored: 1 });
    // `me` narrows the other menus but is no login of its own to list.
    const mine = facets({ filters: { author: "me" } });
    expect(byValue(mine.authors)).toEqual({ ada: 2, octocat: 1 });
    expect(byValue(mine.labels)).toEqual({ bug: 1 });
  });

  it("counts a row read by both the list and the broad page once", () => {
    expect(facets({}, [...rows, ...rows]).loaded).toBe(4);
  });
});

describe("withoutScratchProjectScope", () => {
  const projects = [
    { id: "repo", environmentId: "env-a" },
    { id: "scratch", environmentId: "env-a", isScratch: true as const },
  ];

  it("reads a scope saved on the Scratch folder as all projects", () => {
    const controls = withoutScratchProjectScope(
      { ...DEFAULT_PR_LIST_CONTROLS, projectId: "scratch", projectEnvironmentId: "env-a" },
      projects,
    );
    expect(controls.projectId).toBeUndefined();
    expect(controls.projectEnvironmentId).toBeUndefined();
  });

  it("keeps a repository scope, and one whose projects have not arrived yet", () => {
    const repository = {
      ...DEFAULT_PR_LIST_CONTROLS,
      projectId: "repo",
      projectEnvironmentId: "env-a",
    };
    expect(withoutScratchProjectScope(repository, projects)).toBe(repository);
    const pending = { ...repository, projectId: "scratch" };
    expect(withoutScratchProjectScope(pending, [])).toBe(pending);
  });

  it("keeps another server's project that shares the Scratch folder's id", () => {
    const elsewhere = {
      ...DEFAULT_PR_LIST_CONTROLS,
      projectId: "scratch",
      projectEnvironmentId: "env-b",
    };
    expect(withoutScratchProjectScope(elsewhere, projects)).toBe(elsewhere);
  });
});

describe("pullRequestLabelColors", () => {
  it("keeps the first usable color each label name carries", () => {
    expect(
      pullRequestLabelColors([
        { name: "Bug", color: null },
        { name: "bug", color: "d73a4a" },
        { name: "BUG", color: "#000000" },
        { name: "docs", color: "not-a-color" },
        { name: "size:S", color: "#69C35F" },
      ]),
    ).toEqual({ bug: "#d73a4a", "size:s": "#69C35F" });
  });
});

describe("pullRequestFilterChoices", () => {
  it("keeps the picked value in view and adds host answers no loaded row carries, once", () => {
    expect(
      pullRequestFilterChoices({
        selected: ["size:XL"],
        suggestions: ["bug", "size:XL", "docs"],
        hosted: ["Bug", "backend"],
        query: "b",
      }),
    ).toEqual(["size:XL", "bug", "backend"]);
  });

  it("leaves room for the host's answers when loaded matches alone would fill the list", () => {
    const loaded = Array.from({ length: 120 }, (_, index) => `label-${index}`);
    const rows = pullRequestFilterChoices({
      selected: [],
      suggestions: loaded,
      hosted: ["label-from-host"],
      query: "label",
    });
    expect(rows).toHaveLength(100);
    expect(rows[50]).toBe("label-from-host");
  });
});

describe("shown PR diff stats", () => {
  const cups = EnvironmentId.make("cups");
  const stat = (number: number, additions: number, deletions: number) => ({
    projectId: "project" as PullRequestListEntry["projectId"],
    repository: "org/repo",
    number,
    additions,
    deletions,
  });
  const rows = [
    { ...entry(1), environmentId: cups },
    { ...entry(2, { additions: 4, deletions: 1 }), environmentId: cups },
  ];

  it("keeps the same list when the answers change no row", () => {
    expect(withShownPullRequestStats(rows, [])).toBe(rows);
    expect(withShownPullRequestStats(rows, [{ environmentId: cups, stats: [stat(1, 0, 0)] }])).toBe(
      rows,
    );
    expect(withShownPullRequestStats(rows, [{ environmentId: cups, stats: [stat(2, 9, 9)] }])).toBe(
      rows,
    );
  });

  it("fills only rows without stats, in their own environment", () => {
    const filled = withShownPullRequestStats(rows, [
      { environmentId: EnvironmentId.make("mbp"), stats: [stat(1, 7, 7)] },
      { environmentId: cups, stats: [stat(1, 3, 2), stat(2, 9, 9)] },
    ]);
    expect(filled.map(({ additions, deletions }) => [additions, deletions])).toEqual([
      [3, 2],
      [4, 1],
    ]);
    expect(filled[1]).toBe(rows[1]);
  });
});

describe("cached PR diff stats", () => {
  const stat = (number: number, additions: number) => ({
    projectId: "project" as PullRequestListEntry["projectId"],
    repository: "org/repo",
    number,
    additions,
    deletions: 0,
  });

  it("drops a row's stat and refreshes its stats query when its updatedAt moves", () => {
    const query = {
      refs: [1, 2].map((number) => ({
        projectId: stat(number, 0).projectId,
        repository: "org/repo",
        number,
      })),
    };
    const listed = withListedPullRequests(EMPTY_PULL_REQUEST_STATS_CACHE, [entry(1), entry(2)]);
    expect(listed.refresh).toEqual([]);
    const answered = withAnsweredPullRequestStats(listed.cache, query, [stat(1, 5), stat(2, 7)]);
    expect(withListedPullRequests(answered, [entry(1), entry(2)])).toEqual({
      cache: answered,
      refresh: [],
    });

    const pushed = withListedPullRequests(answered, [
      entry(1, { updatedAt: "2026-10-20T00:00:00Z" }),
      entry(2),
    ]);
    expect([...pushed.cache.stats.values()]).toEqual([stat(2, 7)]);
    expect(pushed.refresh).toEqual([query]);
  });
});
