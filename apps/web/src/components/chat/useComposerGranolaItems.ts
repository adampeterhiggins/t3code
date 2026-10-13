import type { EnvironmentId, GranolaNoteSummary } from "@t3tools/contracts";
import { useCallback } from "react";

import { granolaEnvironment } from "~/state/granola";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { granolaNoteDescription } from "./GranolaNotePicker";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// The server filters one cached listing of recent meetings, so the query settles quickly.
const GRANOLA_SEARCH_DEBOUNCE_MS = 150;
const GRANOLA_RESULT_LIMIT = 20;

function toItems(data: { readonly notes: ReadonlyArray<GranolaNoteSummary> }) {
  return data.notes.map((note): ComposerReferenceItem => ({
    id: `granola-note:${note.id}`,
    type: "granola-note",
    noteId: note.id,
    label: note.title,
    description: granolaNoteDescription(note),
  }));
}

/** Recent Granola meetings for the composer's `#` menu, matched by title and participants. */
export function useComposerGranolaItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = useCallback(
    (query: string) => granolaEnvironment.notes({ environmentId, input: { query } }),
    [environmentId],
  );
  return useComposerReferenceSearch({
    ...input,
    debounceMs: GRANOLA_SEARCH_DEBOUNCE_MS,
    limit: GRANOLA_RESULT_LIMIT,
    searchesEmptyQuery: true,
    atomFor,
    toItems,
  });
}
