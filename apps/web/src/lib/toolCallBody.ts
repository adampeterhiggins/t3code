import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";

/** Split bounded tool summaries into ordinary text and parseable diff blocks. */
export function parseToolCallBody(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith("Diff\n")) {
        try {
          const files = parsePatchFiles(`${block.slice(5).trimEnd()}\n`, undefined, true).flatMap(
            (patch) => patch.files,
          );
          if (files.length > 0) return { kind: "diff" as const, text: block, files };
        } catch {
          // Legacy/provider patches may be incomplete. Keep their readable text.
        }
      }
      return { kind: "text" as const, text: block };
    });
}
