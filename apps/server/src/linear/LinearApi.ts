import {
  LINEAR_ISSUE_MARKDOWN_MAX_CHARS,
  type LinearError,
  type LinearFilterOptions,
  type LinearGetIssueInput,
  type LinearIssueContext,
  type LinearIssueSort,
  type LinearIssueSummary,
  type LinearListIssuesInput,
  type LinearListIssuesResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";

import { LinearAuth } from "./LinearAuth.ts";
import { linearGraphqlRequest } from "./linearGraphql.ts";
import { parseLinearIssueRef, renderLinearIssueMarkdown } from "./linearIssueMarkdown.ts";
import {
  toLinearIdentifierPrefixFilter,
  toLinearIssueFilter,
  toLinearIssueSort,
} from "./linearIssueFilters.ts";

const SUMMARY_FIELDS =
  "id identifier title url priorityLabel updatedAt state { name type color } assignee { name }";

const ASSIGNED_ISSUES_QUERY = `query LinearAssignedIssues {
  viewer {
    assignedIssues(first: 25, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
      nodes { ${SUMMARY_FIELDS} }
    }
  }
}`;

// `searchIssues` is limited to 30 requests a minute; clients debounce typing.
// `searchIssues` is ranked by relevance and can only reorder by created or updated time.
const SEARCH_ISSUES_QUERY = `query LinearSearchIssues($term: String!, $filter: IssueFilter, $orderBy: PaginationOrderBy) {
  searchIssues(term: $term, first: 25, filter: $filter, orderBy: $orderBy) { nodes { ${SUMMARY_FIELDS} } }
}`;

const FILTERED_ISSUES_QUERY = `query LinearFilteredIssues($filter: IssueFilter, $sort: [IssueSortInput!]) {
  issues(first: 50, filter: $filter, sort: $sort) { nodes { ${SUMMARY_FIELDS} } }
}`;

// Four small queries: one combined query exceeds Linear's per-query complexity limit.
const TEAMS_QUERY = `query LinearFilterTeams {
  teams(first: 100) { nodes { id key name states(first: 50) { nodes { name type color position } } } }
}`;
const PROJECTS_QUERY = `query LinearFilterProjects {
  projects(first: 100, filter: { status: { type: { nin: ["completed", "canceled"] } } }) {
    nodes { id name teams(first: 10) { nodes { id } } projectMilestones(first: 25) { nodes { id name } } }
  }
}`;
const USERS_QUERY = `query LinearFilterUsers {
  users(first: 250, filter: { active: { eq: true } }) { nodes { id name displayName isMe } }
}`;
const LABELS_QUERY = `query LinearFilterLabels { issueLabels(first: 250) { nodes { name color } } }`;

const ISSUE_SUMMARY_QUERY = `query LinearIssueSummary($id: String!) {
  issue(id: $id) { ${SUMMARY_FIELDS} }
}`;

const ISSUE_DETAIL_QUERY = `query LinearIssueDetail($id: String!) {
  issue(id: $id) {
    ${SUMMARY_FIELDS}
    description
    team { name }
    project { name }
    labels { nodes { name } }
    parent { identifier title }
    children(first: 50) { nodes { identifier title state { name } } }
    attachments(first: 25) { nodes { title url } }
    comments(first: 50) { nodes { body createdAt user { name } } }
  }
}`;

const Named = Schema.Struct({ name: Schema.String });

const IssueSummaryNode = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  priorityLabel: Schema.NullishOr(Schema.String),
  updatedAt: Schema.String,
  state: Schema.Struct({ name: Schema.String, type: Schema.String, color: Schema.String }),
  assignee: Schema.NullishOr(Named),
});
type IssueSummaryNode = typeof IssueSummaryNode.Type;

const IssueDetailNode = Schema.Struct({
  ...IssueSummaryNode.fields,
  description: Schema.NullishOr(Schema.String),
  team: Schema.NullishOr(Named),
  project: Schema.NullishOr(Named),
  labels: Schema.Struct({ nodes: Schema.Array(Named) }),
  parent: Schema.NullishOr(Schema.Struct({ identifier: Schema.String, title: Schema.String })),
  children: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({ identifier: Schema.String, title: Schema.String, state: Named }),
    ),
  }),
  attachments: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String })),
  }),
  comments: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        body: Schema.String,
        createdAt: Schema.String,
        user: Schema.NullishOr(Named),
      }),
    ),
  }),
});

const AssignedIssuesData = Schema.Struct({
  viewer: Schema.Struct({
    assignedIssues: Schema.Struct({ nodes: Schema.Array(IssueSummaryNode) }),
  }),
});
const SearchIssuesData = Schema.Struct({
  searchIssues: Schema.Struct({ nodes: Schema.Array(IssueSummaryNode) }),
});
const IssueSummaryData = Schema.Struct({ issue: IssueSummaryNode });
const FilteredIssuesData = Schema.Struct({
  issues: Schema.Struct({ nodes: Schema.Array(IssueSummaryNode) }),
});
const Nodes = <S extends Schema.Top>(item: S) => Schema.Struct({ nodes: Schema.Array(item) });
const TeamsData = Schema.Struct({
  teams: Nodes(
    Schema.Struct({
      id: Schema.String,
      key: Schema.String,
      name: Schema.String,
      states: Nodes(
        Schema.Struct({
          name: Schema.String,
          type: Schema.String,
          color: Schema.String,
          position: Schema.Number,
        }),
      ),
    }),
  ),
});
const ProjectsData = Schema.Struct({
  projects: Nodes(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      teams: Nodes(Schema.Struct({ id: Schema.String })),
      projectMilestones: Nodes(Schema.Struct({ id: Schema.String, name: Schema.String })),
    }),
  ),
});
const UsersData = Schema.Struct({
  users: Nodes(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      displayName: Schema.String,
      isMe: Schema.Boolean,
    }),
  ),
});
const LabelsData = Schema.Struct({
  issueLabels: Nodes(Schema.Struct({ name: Schema.String, color: Schema.String })),
});

// Linear's workflow order, used to list statuses the way Linear's own menus do.
const STATE_TYPE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const DEFAULT_SORT: LinearIssueSort = { field: "updated", direction: "desc" };
const IssueDetailData = Schema.Struct({ issue: IssueDetailNode });

function toSummary(node: IssueSummaryNode): LinearIssueSummary {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    stateName: node.state.name,
    stateType: node.state.type,
    stateColor: node.state.color,
    // Linear labels priority 0 "No priority"; that is the absence of one.
    priorityLabel:
      node.priorityLabel && node.priorityLabel !== "No priority" ? node.priorityLabel : null,
    assigneeName: node.assignee?.name ?? null,
    updatedAt: node.updatedAt,
  };
}

export class LinearApi extends Context.Service<
  LinearApi,
  {
    readonly listIssues: (
      input: LinearListIssuesInput,
    ) => Effect.Effect<LinearListIssuesResult, LinearError>;
    readonly getIssue: (
      input: LinearGetIssueInput,
    ) => Effect.Effect<LinearIssueContext, LinearError>;
    readonly getFilterOptions: Effect.Effect<LinearFilterOptions, LinearError>;
    /** The issue's summary fields alone, for linking and live status. */
    readonly getIssueSummary: (
      input: LinearGetIssueInput,
    ) => Effect.Effect<LinearIssueSummary, LinearError>;
  }
>()("t3/linear/LinearApi") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const auth = yield* LinearAuth;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);

  const query = <S extends Schema.Top>(
    document: string,
    variables: Record<string, unknown>,
    data: S,
  ) =>
    auth.accessToken.pipe(
      Effect.flatMap((token) => linearGraphqlRequest(token, document, variables, data)),
      Effect.tapError((error) => (error.reason === "revoked" ? auth.markRevoked : Effect.void)),
      Effect.provide(services),
    );

  const listIssues = Effect.fn("linear.list_issues")(function* (input: LinearListIssuesInput) {
    const text = input.query?.trim() ?? "";
    const identifier = text.length > 0 ? parseLinearIssueRef(text) : null;
    if (identifier !== null) {
      const data = yield* query(ISSUE_SUMMARY_QUERY, { id: identifier }, IssueSummaryData).pipe(
        Effect.map((result) => [toSummary(result.issue)]),
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () => Effect.succeed([]),
        ),
      );
      return { issues: data };
    }
    const filter = input.filters ? toLinearIssueFilter(input.filters) : undefined;
    const sort = input.sort ?? DEFAULT_SORT;
    const identifierPrefix = text.length > 0 ? toLinearIdentifierPrefixFilter(text) : null;
    if (identifierPrefix !== null) {
      const data = yield* query(
        FILTERED_ISSUES_QUERY,
        {
          filter: filter === undefined ? identifierPrefix : { and: [filter, identifierPrefix] },
          sort: toLinearIssueSort(sort),
        },
        FilteredIssuesData,
      );
      // No team has that key: the text was a word, so search for it instead.
      if (data.issues.nodes.length > 0) return { issues: data.issues.nodes.map(toSummary) };
    }
    if (text.length > 0) {
      const orderBy =
        sort.field === "updated" ? "updatedAt" : sort.field === "created" ? "createdAt" : null;
      const data = yield* query(
        SEARCH_ISSUES_QUERY,
        { term: text, filter: filter ?? null, orderBy },
        SearchIssuesData,
      );
      return { issues: data.searchIssues.nodes.map(toSummary) };
    }
    if (filter === undefined && input.sort === undefined) {
      const data = yield* query(ASSIGNED_ISSUES_QUERY, {}, AssignedIssuesData);
      return { issues: data.viewer.assignedIssues.nodes.map(toSummary) };
    }
    const data = yield* query(
      FILTERED_ISSUES_QUERY,
      { filter: filter ?? {}, sort: toLinearIssueSort(sort) },
      FilteredIssuesData,
    );
    return { issues: data.issues.nodes.map(toSummary) };
  });

  const getFilterOptions = Effect.fn("linear.get_filter_options")(function* () {
    const [teams, projects, users, labels] = yield* Effect.all(
      [
        query(TEAMS_QUERY, {}, TeamsData),
        query(PROJECTS_QUERY, {}, ProjectsData),
        query(USERS_QUERY, {}, UsersData),
        query(LABELS_QUERY, {}, LabelsData),
      ],
      { concurrency: "unbounded" },
    );
    // Each team has its own copy of a status or label; the picker filters by name.
    const states = new Map<string, { name: string; type: string; color: string; rank: number }>();
    for (const team of teams.teams.nodes) {
      for (const state of team.states.nodes) {
        if (states.has(state.name)) continue;
        const typeRank = STATE_TYPE_ORDER.indexOf(state.type);
        states.set(state.name, {
          name: state.name,
          type: state.type,
          color: state.color,
          rank: (typeRank === -1 ? STATE_TYPE_ORDER.length : typeRank) * 1_000 + state.position,
        });
      }
    }
    const labelsByName = new Map<string, { name: string; color: string }>();
    for (const label of labels.issueLabels.nodes) {
      if (!labelsByName.has(label.name)) labelsByName.set(label.name, label);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      teams: teams.teams.nodes.map(({ id, key, name }) => ({ id, key, name })).toSorted(byName),
      states: [...states.values()]
        .toSorted((a, b) => a.rank - b.rank)
        .map(({ name, type, color }) => ({ name, type, color })),
      projects: projects.projects.nodes
        .map((project) => ({
          id: project.id,
          name: project.name,
          teamIds: project.teams.nodes.map((team) => team.id),
          milestones: project.projectMilestones.nodes,
        }))
        .toSorted(byName),
      users: users.users.nodes
        .map((user) => ({ id: user.id, name: user.displayName || user.name, isMe: user.isMe }))
        .toSorted((a, b) => Number(b.isMe) - Number(a.isMe) || byName(a, b)),
      labels: [...labelsByName.values()].toSorted(byName),
    } satisfies LinearFilterOptions;
  });

  const getIssue = Effect.fn("linear.get_issue")(function* (input: LinearGetIssueInput) {
    const { issue } = yield* query(
      ISSUE_DETAIL_QUERY,
      { id: parseLinearIssueRef(input.id) ?? input.id },
      IssueDetailData,
    );
    const summary = toSummary(issue);
    const markdown = renderLinearIssueMarkdown(
      {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        description: issue.description ?? null,
        stateName: summary.stateName,
        priorityLabel: summary.priorityLabel,
        assigneeName: summary.assigneeName,
        teamName: issue.team?.name ?? null,
        projectName: issue.project?.name ?? null,
        labels: issue.labels.nodes.map((label) => label.name),
        parent: issue.parent ?? null,
        children: issue.children.nodes.map((child) => ({
          identifier: child.identifier,
          title: child.title,
          stateName: child.state.name,
        })),
        links: issue.attachments.nodes,
        comments: issue.comments.nodes.map((comment) => ({
          author: comment.user?.name ?? "Linear",
          createdAt: comment.createdAt,
          body: comment.body,
        })),
      },
      LINEAR_ISSUE_MARKDOWN_MAX_CHARS,
    );
    return { ...summary, markdown } satisfies LinearIssueContext;
  });

  const getIssueSummary = Effect.fn("linear.get_issue_summary")(function* (
    input: LinearGetIssueInput,
  ) {
    const { issue } = yield* query(
      ISSUE_SUMMARY_QUERY,
      { id: parseLinearIssueRef(input.id) ?? input.id },
      IssueSummaryData,
    );
    return toSummary(issue);
  });

  return LinearApi.of({
    listIssues,
    getIssue,
    getFilterOptions: getFilterOptions(),
    getIssueSummary,
  });
});

export const layer = Layer.effect(LinearApi, make);
