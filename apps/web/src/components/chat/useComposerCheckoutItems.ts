import type { CheckoutInspectEntry, EnvironmentId } from "@t3tools/contracts";
import {
  checkoutAccessForDriver,
  checkoutCandidates,
  checkoutContextRecord,
  checkoutPathKey,
  looksLikeCheckoutPath,
  rankCheckoutCandidates,
} from "@t3tools/shared/checkouts";

import { useCheckoutContextStore } from "~/checkoutContextStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useProjects, useServerConfigs, useThreadShells } from "~/state/entities";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";

const INSPECT_DEBOUNCE_MS = 200;
const RESULT_LIMIT = 20;
const RECENTS_STORAGE_KEY = "t3code:checkout-recents";
const MAX_RECENTS = 30;

export function readCheckoutRecents(): ReadonlyArray<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function recordCheckoutRecent(path: string): void {
  try {
    const key = checkoutPathKey(path);
    const next = [key, ...readCheckoutRecents().filter((entry) => entry !== key)];
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next.slice(0, MAX_RECENTS)));
  } catch {
    // Ranking is a nicety.
  }
}

/**
 * Project roots and worktrees the client already knows, with git status for the
 * ones on this environment. A pasted path is inspected too. Other environments
 * stay in the list and cannot be selected.
 */
export function useComposerCheckoutItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly query: string },
) {
  const projects = useProjects();
  const threads = useThreadShells(input.enabled);
  const configs = useServerConfigs();
  const candidates = checkoutCandidates({
    currentEnvironmentId: environmentId,
    projects,
    worktrees: threads.map((thread) => ({
      environmentId: thread.environmentId,
      worktreePath: thread.worktreePath,
    })),
    environmentLabel: (id) =>
      configs.get(id as EnvironmentId)?.environment.label ?? "Another environment",
  });
  const recentRank = new Map(readCheckoutRecents().map((path, index) => [path, index] as const));
  const ranked = rankCheckoutCandidates(
    candidates,
    looksLikeCheckoutPath(input.query) ? "" : input.query,
    recentRank,
  );
  const pasted = looksLikeCheckoutPath(input.query) ? checkoutPathKey(input.query.trim()) : null;
  const selectablePaths = ranked
    .filter((candidate) => candidate.selectable)
    .slice(0, RESULT_LIMIT)
    .map((candidate) => candidate.path);
  if (pasted !== null && !selectablePaths.includes(pasted)) selectablePaths.unshift(pasted);
  const inspectPaths = selectablePaths.slice(0, 32);
  const pathsKey = input.enabled && inspectPaths.length > 0 ? inspectPaths.join("\n") : null;
  const settledKey = useDebouncedValue(pathsKey, INSPECT_DEBOUNCE_MS);
  const inspection = useEnvironmentQuery(
    settledKey === null
      ? null
      : sourceControlEnvironment.checkouts({
          environmentId,
          input: { paths: settledKey.split("\n") },
        }),
  );
  const byPath = new Map<string, CheckoutInspectEntry>();
  for (const entry of inspection.data?.entries ?? [])
    byPath.set(checkoutPathKey(entry.path), entry);
  const rows = input.enabled
    ? ranked
        .slice(0, RESULT_LIMIT)
        .map((candidate) =>
          toCheckoutItem(candidate, byPath.get(checkoutPathKey(candidate.path)) ?? null),
        )
    : [];
  const pastedEntry = pasted === null ? null : (byPath.get(pasted) ?? null);
  const items: ReadonlyArray<ComposerReferenceItem> =
    !input.enabled ||
    pasted === null ||
    rows.some((item) => item.type === "checkout" && checkoutPathKey(item.path) === pasted)
      ? rows
      : [
          toCheckoutItem(
            {
              environmentId,
              environmentLabel: configs.get(environmentId)?.environment.label ?? "This environment",
              selectable: pastedEntry?.exists === true,
              path: pastedEntry?.path ?? pasted,
              name: pastedEntry?.name ?? pasted,
              kind: "project",
            },
            pastedEntry,
          ),
          ...rows,
        ];
  return {
    items,
    entries: inspection.data?.entries ?? [],
    preloaded: input.enabled ? items : [],
    hasLocalCandidates: candidates.some((candidate) => candidate.selectable),
    isPending:
      input.enabled && pathsKey !== null && (settledKey !== pathsKey || inspection.isPending),
    error: input.enabled ? inspection.error : null,
  };
}

function toCheckoutItem(
  candidate: ReturnType<typeof checkoutCandidates>[number],
  entry: CheckoutInspectEntry | null,
): ComposerReferenceItem {
  const branch = entry?.branch ?? null;
  const missing = entry !== null && !entry.exists;
  return {
    id: `checkout:${candidate.environmentId}:${checkoutPathKey(candidate.path)}`,
    type: "checkout",
    environmentId: candidate.environmentId as EnvironmentId,
    path: entry?.path ?? candidate.path,
    branch,
    headSha: entry?.headSha ?? null,
    changedFiles: entry === null ? null : entry.changedFiles,
    ahead: entry?.ahead ?? 0,
    selectable: candidate.selectable && !missing,
    label: candidate.name,
    description: `${branch ?? ""} ${candidate.path} ${candidate.environmentLabel}`,
  };
}

export function useAttachCheckout(driver: string | null) {
  const link = useAtomCommand(threadEnvironment.linkCheckout, { reportFailure: true });
  return (
    threadRef: ScopedThreadRef,
    item: Extract<ComposerReferenceItem, { type: "checkout" }>,
    options: { readonly link: boolean },
  ) => {
    if (!item.selectable || item.environmentId !== threadRef.environmentId) return;
    const record = checkoutContextRecord({
      path: item.path,
      name: item.label,
      branch: item.branch,
      headSha: item.headSha,
      changedFiles: item.changedFiles ?? 0,
      ahead: item.ahead,
      access: checkoutAccessForDriver(driver),
      environmentId: threadRef.environmentId,
    });
    useCheckoutContextStore.getState().upsert(threadRef.threadId, record);
    useComposerDraftStore.getState().insertContextReference(threadRef, {
      kind: "checkout",
      contextId: record.contextId,
      label: record.label,
    });
    recordCheckoutRecent(record.path);
    if (options.link) {
      void link({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, path: record.path, name: record.label },
      });
    }
  };
}
