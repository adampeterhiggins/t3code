import {
  LINEAR_ISSUE_MARKDOWN_MAX_CHARS,
  type LinearError,
  type LinearGetIssueInput,
  type LinearIssueContext,
  type LinearIssueSummary,
  type LinearListIssuesInput,
  type LinearListIssuesResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";

import { LinearAuth } from "./LinearAuth.ts";
import { linearGraphqlRequest } from "./linearGraphql.ts";
import { parseLinearIssueRef, renderLinearIssueMarkdown } from "./linearIssueMarkdown.ts";

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
const SEARCH_ISSUES_QUERY = `query LinearSearchIssues($term: String!) {
  searchIssues(term: $term, first: 20) { nodes { ${SUMMARY_FIELDS} } }
}`;

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
    if (text.length === 0) {
      const data = yield* query(ASSIGNED_ISSUES_QUERY, {}, AssignedIssuesData);
      return { issues: data.viewer.assignedIssues.nodes.map(toSummary) };
    }
    const identifier = parseLinearIssueRef(text);
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
    const data = yield* query(SEARCH_ISSUES_QUERY, { term: text }, SearchIssuesData);
    return { issues: data.searchIssues.nodes.map(toSummary) };
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

  return LinearApi.of({ listIssues, getIssue });
});

export const layer = Layer.effect(LinearApi, make);
