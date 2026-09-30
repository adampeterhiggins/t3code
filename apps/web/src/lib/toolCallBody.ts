import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";

import { buildPatchCacheKey } from "./diffRendering";

/** Split bounded tool summaries into ordinary text and parseable diff blocks. */
export function parseToolCallBody(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith("Diff\n")) {
        try {
          const patch = `${block.slice(5).trimEnd()}\n`;
          // Worker-highlighted diffs are matched to their results by cache key.
          const files = parsePatchFiles(
            patch,
            buildPatchCacheKey(patch, "tool-call"),
            true,
          ).flatMap((patch) => patch.files);
          if (files.length > 0) return { kind: "diff" as const, text: block, files };
        } catch {
          // Legacy/provider patches may be incomplete. Keep their readable text.
        }
      }
      return { kind: "text" as const, text: block };
    });
}
