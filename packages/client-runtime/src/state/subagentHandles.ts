/**
 * Fork: the `@handle` a subagent is referenced by in the composer and shown with across agent UI.
 *
 * A handle is the agent's title as a slug. Agents started by the same thread whose titles slug
 * alike are told apart by spawn order (`-2`, `-3`), so every client derives the same handle
 * without storing one. The handle is display text; a chip carries the agent's ids.
 */
import {
  COMPOSER_CONTEXT_SUBAGENT_TEXT_MAX_CHARS,
  type ComposerContextId,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type SubagentContextRecord,
  type ThreadId,
} from "@t3tools/contracts";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import * as DateTime from "effect/DateTime";

import { formatSubagentDisplayTitle } from "./subagentDisplay.ts";

const HANDLE_MAX_CHARS = 32;

/** "Explore the auth flow!" → "explore-the-auth-flow", cut at a word within 32 characters. */
export function subagentHandleSlug(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  let slug = "";
  for (const word of words) {
    const next = slug === "" ? word : `${slug}-${word}`;
    if (next.length > HANDLE_MAX_CHARS) {
      if (slug === "") slug = word.slice(0, HANDLE_MAX_CHARS);
      break;
    }
    slug = next;
  }
  return slug || "agent";
}

export interface SubagentHandleSubject {
  /** `AgentFleetEntry.key`: the child thread, or `subagent:<id>` before it exists. */
  readonly key: string;
  readonly ownerThreadId: ThreadId;
  readonly title: string;
  readonly spawnedAt: string | null;
}

/** Handles by key. Within one owner, the earliest spawned agent keeps the bare slug. */
export function assignSubagentHandles(
  subjects: ReadonlyArray<SubagentHandleSubject>,
): ReadonlyMap<string, string> {
  const ordered = [...subjects].sort((left, right) => {
    if (left.spawnedAt !== right.spawnedAt) {
      if (left.spawnedAt === null) return 1;
      if (right.spawnedAt === null) return -1;
      return left.spawnedAt < right.spawnedAt ? -1 : 1;
    }
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
  const taken = new Set<string>();
  const handles = new Map<string, string>();
  for (const subject of ordered) {
    const slug = subagentHandleSlug(subject.title);
    let handle = slug;
    for (let suffix = 2; taken.has(`${subject.ownerThreadId}\u0000${handle}`); suffix += 1) {
      handle = `${slug}-${suffix}`;
    }
    taken.add(`${subject.ownerThreadId}\u0000${handle}`);
    handles.set(subject.key, handle);
  }
  return handles;
}

/**
 * Handles of the agents `ownerThreadId` started, by child thread, from thread shells alone: the
 * same handles `deriveThreadAgentFleet` gives agents whose thread exists, without building the
 * fleet. For surfaces that show one thread's handle or its children's.
 */
export function subagentHandlesFromShells(
  ownerThreadId: ThreadId,
  shells: ReadonlyArray<
    Pick<OrchestrationV2ThreadShell, "id" | "title" | "createdAt"> & {
      readonly lineage: Pick<
        OrchestrationV2ThreadShell["lineage"],
        "parentThreadId" | "relationshipToParent"
      >;
    }
  >,
): ReadonlyMap<string, string> {
  const seen = new Set<ThreadId>();
  const subjects: SubagentHandleSubject[] = [];
  for (const shell of shells) {
    if (
      seen.has(shell.id) ||
      shell.lineage.parentThreadId !== ownerThreadId ||
      shell.lineage.relationshipToParent !== "subagent"
    ) {
      continue;
    }
    seen.add(shell.id);
    subjects.push({
      key: shell.id,
      ownerThreadId,
      title: formatSubagentDisplayTitle(shell.title),
      spawnedAt: DateTime.formatIso(shell.createdAt),
    });
  }
  return assignSubagentHandles(subjects);
}

/** True when a typed `@` query names the agent: a handle prefix, or words of its title. */
export function matchesSubagentQuery(
  subject: { readonly handle: string; readonly title: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (subject.handle.includes(needle)) return true;
  const title = subject.title.toLowerCase();
  return needle.split(/[\s-]+/).every((word) => title.includes(word));
}

/** 32-bit FNV-1a, as hex: tells apart ids that share the slug's truncated prefix. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * One chip per agent, keyed by its child thread, else its record. Those ids run past the context
 * id's 128 characters and share long prefixes (Claude's native thread ids), so the id is a short
 * slug plus a hash of the whole id.
 */
export function subagentContextId(agentId: string): ComposerContextId {
  const slug = agentId
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-48);
  return `subagent_${slug}-${fnv1a(agentId)}` as ComposerContextId;
}

function clip(text: string): string {
  return text.length > COMPOSER_CONTEXT_SUBAGENT_TEXT_MAX_CHARS
    ? `${text.slice(0, COMPOSER_CONTEXT_SUBAGENT_TEXT_MAX_CHARS - 1)}…`
    : text;
}

/** The chip payload for an agent: its ids, how to reach it, and its task and outcome now. */
export function subagentContextRecord(input: {
  readonly environmentId: EnvironmentId;
  readonly subagent: OrchestrationV2Subagent;
  readonly handle: string;
  readonly title: string;
  /** The status the user sees, which follows a live follow-up run. */
  readonly status: string;
}): SubagentContextRecord {
  const { subagent } = input;
  return {
    version: 1,
    kind: "subagent",
    contextId: subagentContextId(subagent.childThreadId ?? subagent.id),
    label: sanitizeComposerContextLabel(`@${input.handle}`, "subagent"),
    environmentId: input.environmentId,
    ownerThreadId: subagent.threadId,
    subagentId: subagent.id,
    childThreadId: subagent.childThreadId,
    handle: input.handle,
    title: sanitizeComposerContextLabel(input.title, "subagent"),
    origin: subagent.origin,
    driver: subagent.driver,
    nativeAgentId: subagent.nativeTaskRef?.nativeId?.slice(0, 2_048) ?? null,
    status: input.status,
    prompt: clip(subagent.prompt),
    result: subagent.result === null ? null : clip(subagent.result),
  };
}

/**
 * The chip payload for an agent known only from its child thread, while the record the thread
 * that started it holds is not loaded (an older run paged out of the client's history).
 */
export function subagentContextRecordFromShell(input: {
  readonly environmentId: EnvironmentId;
  readonly ownerThreadId: ThreadId;
  readonly shell: Pick<OrchestrationV2ThreadShell, "id" | "creationSource" | "providerInstanceId">;
  readonly handle: string;
  readonly title: string;
  readonly status: string;
}): SubagentContextRecord {
  return {
    version: 1,
    kind: "subagent",
    contextId: subagentContextId(input.shell.id),
    label: sanitizeComposerContextLabel(`@${input.handle}`, "subagent"),
    environmentId: input.environmentId,
    ownerThreadId: input.ownerThreadId,
    subagentId: null,
    childThreadId: input.shell.id,
    handle: input.handle,
    title: sanitizeComposerContextLabel(input.title, "subagent"),
    origin: input.shell.creationSource === "provider" ? "provider_native" : "app_owned",
    driver: input.shell.providerInstanceId,
    nativeAgentId: null,
    status: input.status,
    prompt: "",
    result: null,
  };
}
