import type { ThreadGroup, ThreadGroups } from "@t3tools/contracts/settings";

const NO_GROUPS: ThreadGroups = {};

/**
 * Registered thread groups (name → icon and accent) are a shared server
 * setting written to every connected environment, so reading merges them: a
 * group looks the same whichever server its threads are on. The first
 * environment to register a group wins, so drift between servers never flips
 * a group's look. Mirrors web's useThreadGroupStyles.
 */
export function mergeThreadGroups(perEnvironment: Iterable<ThreadGroups>): ThreadGroups {
  let merged = NO_GROUPS;
  for (const own of perEnvironment) {
    if (Object.keys(own).length > 0) merged = { ...own, ...merged };
  }
  return merged;
}

/**
 * The full map to write when one group is registered, restyled, renamed
 * (`from` differs from `name`) or deleted (`group` null). Null when nothing
 * would change, so callers skip the write.
 */
export function planThreadGroups(
  groups: ThreadGroups,
  input: { readonly from?: string; readonly name: string; readonly group: ThreadGroup | null },
): ThreadGroups | null {
  const from = input.from ?? input.name;
  const { [from]: previous, ...rest } = groups;
  if (input.group === null) return previous === undefined ? null : rest;
  if (from === input.name && JSON.stringify(previous) === JSON.stringify(input.group)) return null;
  return { ...rest, [input.name]: input.group };
}
