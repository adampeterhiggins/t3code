import { useMemo, useState } from "react";
import type { AsyncResult, Atom } from "effect/reactivity";

import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import {
  type ComposerReferenceItem,
  dedupeComposerReferenceItems,
  matchesComposerReferenceQuery,
} from "./composerReferenceMenu.logic";

export interface ComposerReferenceSearch {
  /** Rows for the current query; while it settles, the last results narrowed locally. */
  readonly items: ReadonlyArray<ComposerReferenceItem>;
  /** Rows for an empty query, loaded as soon as `#` opens so the tab and prediction start warm. */
  readonly preloaded: ReadonlyArray<ComposerReferenceItem>;
  readonly error: string | null;
  readonly isPending: boolean;
}

const EMPTY_ITEMS: ReadonlyArray<ComposerReferenceItem> = [];

/**
 * One `#` tab's remote search. The empty-query list loads whenever the tab is available; the typed
 * query only searches while the tab is visible and once typing settles, which keeps rate-limited
 * services within their limits. Between keystrokes the tab keeps showing the last results that
 * still match instead of emptying, so typing never waits on the network to see rows.
 */
export function useComposerReferenceSearch<A, E>(input: {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly query: string;
  readonly debounceMs: number;
  readonly limit: number;
  /** False for services that need a word to search, such as Slack. */
  readonly searchesEmptyQuery: boolean;
  readonly atomFor: (query: string) => Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  /** Module-level so the rows only rebuild when the data does. */
  readonly toItems: (data: A) => ReadonlyArray<ComposerReferenceItem>;
}): ComposerReferenceSearch {
  const { enabled, active, debounceMs, limit, searchesEmptyQuery, atomFor, toItems } = input;
  const preloadedResult = useEnvironmentQuery(enabled && searchesEmptyQuery ? atomFor("") : null);
  const query =
    enabled && active && (searchesEmptyQuery || input.query.length > 0) ? input.query : null;
  const debouncedQuery = useDebouncedValue(query, debounceMs);
  const settledQuery = query === debouncedQuery ? query : null;
  const searchResult = useEnvironmentQuery(
    settledQuery === null || settledQuery === "" ? null : atomFor(settledQuery),
  );
  const result = settledQuery === "" ? preloadedResult : searchResult;

  const preloaded = useMemo(
    () => (preloadedResult.data === null ? EMPTY_ITEMS : toItems(preloadedResult.data)),
    [preloadedResult.data, toItems],
  );
  const fresh = useMemo(
    () =>
      settledQuery === null || result.data === null
        ? null
        : { query: settledQuery, items: toItems(result.data).slice(0, limit) },
    [limit, result.data, settledQuery, toItems],
  );
  // The last settled results, adjusted during render so the next keystroke can narrow them.
  const [retained, setRetained] = useState(fresh);
  if (fresh !== null && fresh !== retained) setRetained(fresh);

  const items = useMemo(() => {
    if (query === null) return EMPTY_ITEMS;
    if (fresh !== null) return fresh.items;
    return dedupeComposerReferenceItems([...(retained?.items ?? []), ...preloaded])
      .filter((item) => matchesComposerReferenceQuery(item, query))
      .slice(0, limit);
  }, [fresh, limit, preloaded, query, retained]);

  return {
    items,
    preloaded,
    error: query === null ? null : (result.error ?? null),
    isPending: query !== null && (fresh === null || result.isPending),
  };
}
