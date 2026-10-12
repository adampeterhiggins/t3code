import { filterComposerPullRequestMatches } from "@t3tools/shared/composerPullRequestMatches";
import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { environmentSession } from "./session";
import { useEnvironmentPresentation } from "./presentation";
import type { VcsRefTarget } from "@t3tools/client-runtime/state/vcs";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ProjectId,
  ThreadId,
  VcsListRefsResult,
  VcsRef,
} from "@t3tools/contracts";
import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
  type EnvironmentThreadSearchMatch,
} from "@t3tools/client-runtime/state/thread-search";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { turnItemDetailRevision } from "@t3tools/client-runtime/work-log/item-detail";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { appAtomRegistry } from "./atom-registry";
import { orchestrationEnvironment } from "./orchestration";
import { projectEnvironment } from "./projects";
import { useEnvironmentQuery } from "./query";
import { vcsEnvironment } from "./vcs";
import { composerPullRequests } from "./pull-requests";
import {
  buildCheckpointDiffTargets,
  normalizeComposerPathSearchQuery,
  type CheckpointDiffTarget,
} from "./queryTargets";

const COMPOSER_PATH_SEARCH_DEBOUNCE_MS = 200;
const COMPOSER_PATH_SEARCH_LIMIT = 20;
const THREAD_SEARCH_DEBOUNCE_MS = 200;
const VCS_REF_LIST_LIMIT = 100;
const EMPTY_REFS: ReadonlyArray<VcsRef> = [];
const INITIAL_BRANCH_CURSORS = [undefined] as const;
const EMPTY_THREAD_SEARCH_MATCHES: ReadonlyArray<EnvironmentThreadSearchMatch> = Object.freeze([]);
const EMPTY_THREAD_SEARCH_ATOM = Atom.make({
  matches: EMPTY_THREAD_SEARCH_MATCHES,
  isLoading: false,
}).pipe(Atom.withLabel("mobile:thread-search:empty"));

const threadSearchResultsAtom = createThreadSearchResultsAtomFamily({
  getSearchAtom: (environmentId, query) =>
    orchestrationEnvironment.threadSearch({
      environmentId,
      input: { query },
    }),
  labelPrefix: "mobile:thread-search",
});

export interface ComposerPathSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string | null;
}

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs, value]);

  return debounced;
}

/**
 * Pull requests for the composer's `#` menu. The project's recent pull requests load as soon as
 * `#` opens and each keystroke filters them locally; a word also searches the host once typing
 * settles, and the last search stays visible while the next one loads.
 */
export function useComposerPullRequestSearch(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  repository: string | null;
  query: string | null;
}) {
  const open =
    input.query !== null &&
    input.environmentId !== null &&
    input.projectId !== null &&
    input.repository !== null;
  const numeric = input.query !== null && /^\d*$/.test(input.query);
  const textQuery = open && !numeric ? input.query : null;
  const debouncedTextQuery = useDebouncedValue(textQuery, 180);
  const settledTextQuery = textQuery === debouncedTextQuery ? textQuery : null;
  const listFor = (query: string | null) =>
    composerPullRequests.list({
      environmentId: input.environmentId!,
      input: {
        projectId: input.projectId!,
        state: "all",
        limit: 200,
        ...(query ? { query } : {}),
      },
    });
  const base = useEnvironmentQuery(open ? listFor(null) : null);
  const search = useEnvironmentQuery(settledTextQuery ? listFor(settledTextQuery) : null);
  const freshSearch = settledTextQuery ? search.data : null;
  const [retainedSearch, setRetainedSearch] = useState(freshSearch);
  if (freshSearch !== null && freshSearch !== retainedSearch) setRetainedSearch(freshSearch);

  const rawNumber = open && numeric && input.query ? Number(input.query) : null;
  const number = useDebouncedValue(rawNumber, 180) === rawNumber ? rawNumber : null;
  const hasExact = base.data?.entries.some(
    (entry) =>
      entry.number === number && entry.repository.toLowerCase() === input.repository?.toLowerCase(),
  );
  const exact = useEnvironmentQuery(
    open && number !== null && Number.isSafeInteger(number) && number > 0 && !hasExact
      ? composerPullRequests.detail({
          environmentId: input.environmentId!,
          input: { projectId: input.projectId!, repository: input.repository!, number },
        })
      : null,
  );
  const entries = useMemo(() => {
    if (!open) return [];
    const exactEntries = exact.data && exact.data.number === rawNumber ? [exact.data] : [];
    if (numeric) {
      return filterComposerPullRequestMatches({
        entries: [...exactEntries, ...(base.data?.entries ?? [])],
        projectId: input.projectId!,
        repository: input.repository!,
        query: input.query ?? "",
        limit: 20,
      });
    }
    const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const found = [
      ...((freshSearch ?? retainedSearch)?.entries ?? []),
      ...(base.data?.entries ?? []),
    ].filter(
      (entry) =>
        entry.projectId === input.projectId &&
        entry.repository.toLowerCase() === input.repository?.toLowerCase() &&
        words.every((word) =>
          `${entry.title} ${entry.headBranch} ${entry.baseBranch}`.toLowerCase().includes(word),
        ),
    );
    const unique = new Map<number, (typeof found)[number]>();
    for (const entry of found) if (!unique.has(entry.number)) unique.set(entry.number, entry);
    return [...unique.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20);
  }, [
    base.data,
    exact.data,
    freshSearch,
    input.projectId,
    input.query,
    input.repository,
    numeric,
    open,
    rawNumber,
    retainedSearch,
  ]);
  return {
    entries,
    isPending:
      open &&
      (base.isPending ||
        (textQuery !== null && (settledTextQuery === null || search.isPending)) ||
        rawNumber !== number ||
        exact.isPending),
    error: base.error ?? base.data?.errors[0]?.message ?? search.error ?? exact.error,
  };
}

export function useThreadSearch(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
): {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isPending: boolean;
} {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = environmentIds.length > 0 && normalizedQuery.length >= 2;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const searchKey = useMemo(
    () => (settledQuery === null ? null : makeThreadSearchKey(environmentIds, settledQuery)),
    [environmentIds, settledQuery],
  );
  const result = useAtomValue(
    searchKey === null ? EMPTY_THREAD_SEARCH_ATOM : threadSearchResultsAtom(searchKey),
  );
  const isDebouncing = canSearch && normalizedQuery !== debouncedQuery;
  return {
    matches: isDebouncing ? EMPTY_THREAD_SEARCH_MATCHES : result.matches,
    isPending: canSearch && (isDebouncing || result.isLoading),
  };
}

export function useBranches(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query?: string | null;
}) {
  const query = input.query?.trim() ?? "";
  return useEnvironmentQuery(
    input.environmentId !== null && input.cwd !== null
      ? vcsEnvironment.listRefs({
          environmentId: input.environmentId,
          input: {
            cwd: input.cwd,
            ...(query.length > 0 ? { query } : {}),
            limit: VCS_REF_LIST_LIMIT,
          },
        })
      : null,
  );
}

export function usePaginatedBranches(target: VcsRefTarget) {
  const query = target.query?.trim() ?? "";
  const targetKey =
    target.environmentId !== null && target.cwd !== null
      ? JSON.stringify([target.environmentId, target.cwd, query])
      : null;
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<number | undefined>;
  }>({
    targetKey,
    cursors: INITIAL_BRANCH_CURSORS,
  });
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_BRANCH_CURSORS;
  const pageAtoms = useMemo(
    () =>
      target.environmentId !== null && target.cwd !== null
        ? cursors.map((cursor) =>
            vcsEnvironment.listRefs({
              environmentId: target.environmentId!,
              input: {
                cwd: target.cwd!,
                ...(query.length > 0 ? { query } : {}),
                ...(cursor === undefined ? {} : { cursor }),
                limit: VCS_REF_LIST_LIMIT,
              },
            }),
          )
        : [],
    [cursors, query, target.cwd, target.environmentId],
  );
  const pagesAtom = useMemo(
    () =>
      Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
        Atom.withLabel(`mobile:vcs-ref-pages:${targetKey ?? "empty"}`),
      ),
    [pageAtoms, targetKey],
  );
  const results = useAtomValue(pagesAtom);
  const values = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) {
      refs.set(ref.name, ref);
    }
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const lastResult = results.at(-1);
  const isFetchingNextPage =
    results.length > 1 &&
    lastResult?.waiting === true &&
    Option.isNone(AsyncResult.value(lastResult));
  const failed = results.find((result) => result._tag === "Failure");
  const error =
    failed?._tag === "Failure"
      ? (() => {
          const cause = Cause.squash(failed.cause);
          return cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Failed to load refs.";
        })()
      : null;
  const refresh = useCallback(() => {
    const firstPage = pageAtoms[0];
    setPagination({ targetKey, cursors: INITIAL_BRANCH_CURSORS });
    if (firstPage !== undefined) {
      appAtomRegistry.refresh(firstPage);
    }
  }, [pageAtoms, targetKey]);
  const loadNext = useCallback(() => {
    if (targetKey === null || data?.nextCursor === null || data?.nextCursor === undefined) {
      return;
    }
    setPagination((current) => {
      const currentCursors =
        current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS;
      return currentCursors.includes(data.nextCursor!)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, data.nextCursor!] };
    });
  }, [data?.nextCursor, targetKey]);

  return {
    data,
    refs: data?.refs ?? EMPTY_REFS,
    error,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage,
    refresh,
    loadNext,
  };
}

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  const normalizedTarget = useMemo(
    () => ({
      environmentId: target.environmentId,
      cwd: target.cwd,
      query: normalizeComposerPathSearchQuery(target.query),
    }),
    [target.cwd, target.environmentId, target.query],
  );
  const debouncedTarget = useDebouncedValue(normalizedTarget, COMPOSER_PATH_SEARCH_DEBOUNCE_MS);
  const fileAccessSession = useEnvironmentQuery(
    debouncedTarget.environmentId === null
      ? null
      : environmentSession.sessionStateAtom(debouncedTarget.environmentId),
  );
  const fileEnvironment = useEnvironmentPresentation(debouncedTarget.environmentId);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const searchTarget =
    debouncedTarget.environmentId !== null &&
    debouncedTarget.cwd !== null &&
    debouncedTarget.query.length > 0
      ? {
          environmentId: debouncedTarget.environmentId,
          input: {
            cwd: debouncedTarget.cwd,
            query: debouncedTarget.query,
            limit: COMPOSER_PATH_SEARCH_LIMIT,
          },
        }
      : null;
  const result = useEnvironmentQuery(
    canReadFiles && searchTarget !== null ? projectEnvironment.searchEntries(searchTarget) : null,
  );
  const hasTarget = searchTarget !== null;

  return {
    entries: result.data?.entries ?? [],
    error:
      !hasTarget || fileAccess.isPending
        ? null
        : canReadFiles
          ? result.error
          : (fileAccess.error ?? "This connection cannot search host files."),
    isPending:
      normalizedTarget.query !== debouncedTarget.query ||
      (hasTarget && (fileAccess.isPending || result.isPending)),
    refresh: result.refresh,
  };
}

export function useCheckpointDiff(target: CheckpointDiffTarget) {
  const targets = useMemo(
    () => buildCheckpointDiffTargets(target),
    [
      target.environmentId,
      target.fromTurnCount,
      target.ignoreWhitespace,
      target.threadId,
      target.toTurnCount,
    ],
  );
  const fullThread = useEnvironmentQuery(
    targets.fullThread === null
      ? null
      : orchestrationEnvironment.fullThreadDiff(targets.fullThread),
  );
  const turn = useEnvironmentQuery(
    targets.turn === null ? null : orchestrationEnvironment.turnDiff(targets.turn),
  );
  return targets.fullThread === null ? turn : fullThread;
}

/** Full input and output for one tool row; pass null to skip fetching. */
export function useTurnItemDetail(
  target: {
    readonly environmentId: EnvironmentId;
    readonly row: OrchestrationV2ProjectedTurnItem;
  } | null,
) {
  return useEnvironmentQuery(
    target === null
      ? null
      : orchestrationEnvironment.turnItem({
          environmentId: target.environmentId,
          input: {
            threadId: target.row.sourceThreadId,
            itemId: target.row.sourceItemId,
            revision: turnItemDetailRevision(target.row.item),
          },
        }),
  );
}
