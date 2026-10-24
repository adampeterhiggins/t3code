import type { EnvironmentId, GoogleFileSummary } from "@t3tools/contracts";

import { googleEnvironment } from "~/state/google";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// Google search is rate-limited per minute, so the `#` query settles longer than pull requests do.
const GOOGLE_SEARCH_DEBOUNCE_MS = 400;
const GOOGLE_RESULT_LIMIT = 20;

function toItems(data: { readonly files: ReadonlyArray<GoogleFileSummary> }) {
  return data.files.map((page): ComposerReferenceItem => ({
    id: `google-file:${page.url}`,
    type: "google-file",
    fileId: page.url,
    label: page.title,
    description: page.url,
  }));
}

/** Google files for the composer's `#` menu, searched by title. */
export function useComposerGoogleItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = (query: string) => googleEnvironment.files({ environmentId, input: { query } });
  return useComposerReferenceSearch({
    ...input,
    debounceMs: GOOGLE_SEARCH_DEBOUNCE_MS,
    limit: GOOGLE_RESULT_LIMIT,
    searchesEmptyQuery: true,
    atomFor,
    toItems,
  });
}
