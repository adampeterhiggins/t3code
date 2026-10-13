import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A local checkout the user can reference in a message or link to a thread.
 * The path is the identity: two checkouts can share a folder name. Nothing
 * here is discovered by scanning the disk; callers name the paths they already
 * know (project roots, worktrees, or a path the user pasted).
 */

const ShortString = Schema.String.check(Schema.isMaxLength(2_048));
const CheckoutPath = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));

export const CHECKOUT_INSPECT_MAX_PATHS = 32;
export const MAX_LINKED_CHECKOUTS = 20;

/** What the provider was given for one checkout when the message was sent. */
export const CheckoutAccess = Schema.Literals(["read", "path-only"]);
export type CheckoutAccess = typeof CheckoutAccess.Type;

/** Git state of one path, as last read. Missing paths come back with `exists: false`. */
export const CheckoutInspectEntry = Schema.Struct({
  path: CheckoutPath,
  exists: Schema.Boolean,
  isRepo: Schema.Boolean,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  branch: Schema.NullOr(ShortString),
  headSha: Schema.NullOr(ShortString),
  headSubject: Schema.NullOr(ShortString),
  changedFiles: NonNegativeInt,
  ahead: NonNegativeInt,
  /**
   * Absolute git common directory when this path is a repository. Two paths
   * with the same key are the same checkout, which is how Locate checks a
   * moved folder. Null when the path is missing or not a repository.
   */
  repositoryKey: Schema.NullOr(ShortString),
});
export type CheckoutInspectEntry = typeof CheckoutInspectEntry.Type;

export const CheckoutInspectInput = Schema.Struct({
  paths: Schema.Array(CheckoutPath).check(Schema.isMaxLength(CHECKOUT_INSPECT_MAX_PATHS)),
});
export type CheckoutInspectInput = typeof CheckoutInspectInput.Type;

export const CheckoutInspectResult = Schema.Struct({
  entries: Schema.Array(CheckoutInspectEntry),
});
export type CheckoutInspectResult = typeof CheckoutInspectResult.Type;

/** A checkout linked to a thread. Live git status is read when shown, not stored. */
export const ThreadLinkedCheckout = Schema.Struct({
  path: CheckoutPath,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  linkedAt: IsoDateTime,
});
export type ThreadLinkedCheckout = typeof ThreadLinkedCheckout.Type;
