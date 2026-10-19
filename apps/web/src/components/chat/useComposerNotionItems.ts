import type { EnvironmentId, NotionPageSummary } from "@t3tools/contracts";

import { notionEnvironment } from "~/state/notion";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// Notion search is rate-limited per minute, so the `#` query settles longer than pull requests do.
const NOTION_SEARCH_DEBOUNCE_MS = 400;
const NOTION_RESULT_LIMIT = 20;

function toItems(data: { readonly pages: ReadonlyArray<NotionPageSummary> }) {
  return data.pages.map((page): ComposerReferenceItem => ({
    id: `notion-page:${page.url}`,
    type: "notion-page",
    pageId: page.id,
    label: page.title,
    description: page.url,
  }));
}

/** Notion pages for the composer's `#` menu, searched by title. */
export function useComposerNotionItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = (query: string) => notionEnvironment.pages({ environmentId, input: { query } });
  return useComposerReferenceSearch({
    ...input,
    debounceMs: NOTION_SEARCH_DEBOUNCE_MS,
    limit: NOTION_RESULT_LIMIT,
    searchesEmptyQuery: true,
    atomFor,
    toItems,
  });
}
