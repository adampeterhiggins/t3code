import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ComposerTrigger } from "~/composer-logic";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { notionEnvironment } from "~/state/notion";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

// Notion search is rate-limited per minute, so the `#` query settles longer than pull requests do.
const NOTION_SEARCH_DEBOUNCE_MS = 400;
const NOTION_RESULT_LIMIT = 20;

/**
 * Notion pages for the composer's `#` menu, on their own tab. The tab only shows once Notion is
 * connected, and only searches while it is visible, which keeps typing within Notion's limit.
 */
export function useComposerNotionItems(
  environmentId: EnvironmentId,
  trigger: ComposerTrigger | null,
  active: boolean,
) {
  const connection = useEnvironmentQuery(
    trigger?.kind === "pull-request"
      ? notionEnvironment.connection({ environmentId, input: {} })
      : null,
  );
  const enabled = trigger?.kind === "pull-request" && connection.data?.phase === "connected";
  const query = enabled && active ? trigger.query : null;
  const debouncedQuery = useDebouncedValue(query, NOTION_SEARCH_DEBOUNCE_MS);
  const settledQuery = query === debouncedQuery ? query : null;
  const pages = useEnvironmentQuery(
    settledQuery === null
      ? null
      : notionEnvironment.pages({ environmentId, input: { query: settledQuery } }),
  );
  const items = useMemo<ComposerCommandItem[]>(
    () =>
      settledQuery === null
        ? []
        : (pages.data?.pages ?? []).slice(0, NOTION_RESULT_LIMIT).map((page) => ({
            id: `notion-page:${page.url}`,
            type: "notion-page",
            pageId: page.id,
            label: page.title,
            description: page.url,
          })),
    [pages.data, settledQuery],
  );
  return {
    enabled,
    items,
    error: pages.error,
    isPending: query !== null && (query !== debouncedQuery || pages.isPending),
  };
}
