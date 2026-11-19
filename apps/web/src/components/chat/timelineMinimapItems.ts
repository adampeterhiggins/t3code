import { markdownPlainText } from "~/lib/markdownPlainText";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";

import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export interface TimelineMinimapItem {
  readonly id: string;
  readonly rowIndex: number;
  readonly userText: string | null;
  readonly assistantText: string | null;
}

export function deriveTimelineMinimapItems(
  rows: ReadonlyArray<MessagesTimelineRow>,
): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    items.push({
      id: row.id,
      rowIndex: index,
      userText: isAttachmentOnlyBootstrapPrompt(row.message.text) ? "" : row.message.text,
      assistantText: resolveFinalAssistantTextForTurn(rows, index),
    });
  }
  return items;
}

function resolveFinalAssistantTextForTurn(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowIndex: number,
) {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }
    if (row.message.role === "user") {
      break;
    }
    if (row.message.role === "assistant") {
      finalAssistantText = row.message.text ?? null;
    }
  }
  return finalAssistantText;
}

// The tooltip shows a few lines; bound parsing work for long messages and streaming responses.
function markdownMinimapPreview(markdown: string | null) {
  if (markdown === null) return null;
  const compact = markdownPlainText(markdown.slice(0, 1_500)).replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact : null;
}

export function resolveTimelineMinimapPreview(
  item: TimelineMinimapItem | null,
): TimelineMinimapItem | null {
  return item === null
    ? null
    : {
        ...item,
        // Before markdown parsing, which would reduce a citation link to "Assistant quote".
        userText: markdownMinimapPreview(
          item.userText === null
            ? null
            : assistantCitationsToPlainText(
                replaceComposerContextReferences(item.userText, (reference) => reference.label),
              ),
        ),
        assistantText: markdownMinimapPreview(item.assistantText),
      };
}
