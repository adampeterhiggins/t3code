import * as Schema from "effect/Schema";

import { ThreadEnvMode } from "./environment.ts";

/**
 * Where a new thread starts, picked by the start-from picker the composer and the
 * quick-message panel share. The labels are only for showing the pick; applying it
 * checks out or attaches from the reference.
 */
export const ComposerStartFromSelection = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pull-request"),
    url: Schema.String,
    number: Schema.Number,
    title: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("branch"),
    branch: Schema.String,
    worktreePath: Schema.NullOr(Schema.String),
    envMode: ThreadEnvMode,
  }),
  Schema.Struct({
    type: Schema.Literal("github-issue"),
    url: Schema.String,
    number: Schema.Number,
    title: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("linear-issue"),
    issueId: Schema.String,
    identifier: Schema.String,
    title: Schema.String,
  }),
]);
export type ComposerStartFromSelection = typeof ComposerStartFromSelection.Type;

/**
 * Previous name, still used by the quick-message relay and panel.
 * Remove it once those call sites use ComposerStartFromSelection.
 */
export const DesktopQuickMessageStartFrom = ComposerStartFromSelection;
export type DesktopQuickMessageStartFrom = ComposerStartFromSelection;
