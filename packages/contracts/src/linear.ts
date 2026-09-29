import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest rendered issue body sent to a client or inlined into a prompt. */
export const LINEAR_ISSUE_MARKDOWN_MAX_CHARS = 32_000;

export const LinearAccount = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  workspaceName: Schema.String,
  workspaceUrlKey: Schema.String,
});
export type LinearAccount = typeof LinearAccount.Type;

/**
 * The environment's Linear connection. `waiting` carries the authorization
 * URL the client opens; the server completes the flow itself when the browser
 * can reach its loopback callback, otherwise the client pastes the redirect
 * URL back through `linear.completeLogin`.
 */
export const LinearConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "waiting", "connected", "failed"]),
  account: Schema.NullOr(LinearAccount),
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  authorizationUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
});
export type LinearConnectionState = typeof LinearConnectionState.Type;

export const LinearCompleteLoginInput = Schema.Struct({
  flowId: TrimmedNonEmptyString,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type LinearCompleteLoginInput = typeof LinearCompleteLoginInput.Type;

export const LinearCancelLoginInput = Schema.Struct({
  flowId: TrimmedNonEmptyString,
});
export type LinearCancelLoginInput = typeof LinearCancelLoginInput.Type;

export const LinearIssueSummary = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  stateName: Schema.String,
  stateType: Schema.String,
  stateColor: Schema.String,
  priorityLabel: Schema.NullOr(Schema.String),
  assigneeName: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type LinearIssueSummary = typeof LinearIssueSummary.Type;

/**
 * `linear.listIssues` payload. An empty query lists the viewer's open assigned
 * issues; an identifier (`ENG-123`) or issue URL is looked up directly; any
 * other text runs Linear's issue search.
 */
export const LinearListIssuesInput = Schema.Struct({
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});
export type LinearListIssuesInput = typeof LinearListIssuesInput.Type;

export const LinearListIssuesResult = Schema.Struct({
  issues: Schema.Array(LinearIssueSummary),
});
export type LinearListIssuesResult = typeof LinearListIssuesResult.Type;

export const LinearGetIssueInput = Schema.Struct({
  /** Issue UUID or identifier such as `ENG-123`. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type LinearGetIssueInput = typeof LinearGetIssueInput.Type;

/** An issue snapshot: summary fields plus a server-rendered markdown body. */
export const LinearIssueContext = Schema.Struct({
  ...LinearIssueSummary.fields,
  markdown: Schema.String.check(Schema.isMaxLength(LINEAR_ISSUE_MARKDOWN_MAX_CHARS)),
});
export type LinearIssueContext = typeof LinearIssueContext.Type;

export const LinearErrorReason = Schema.Literals([
  "not-connected",
  "revoked",
  "rate-limited",
  "not-found",
  "login",
  "api",
]);
export type LinearErrorReason = typeof LinearErrorReason.Type;

export class LinearError extends Schema.TaggedError<LinearError>()("LinearError", {
  reason: LinearErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
