import type { EnvironmentId, SlackMessageSummary } from "@t3tools/contracts";

import { slackEnvironment } from "~/state/slack";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// Slack search is rate-limited per minute, so the `#` query settles longer than pull requests do.
const SLACK_SEARCH_DEBOUNCE_MS = 400;
const SLACK_RESULT_LIMIT = 20;

function toItems(data: { readonly messages: ReadonlyArray<SlackMessageSummary> }) {
  return data.messages.map((message): ComposerReferenceItem => ({
    id: `slack-message:${message.url}`,
    type: "slack-message",
    message,
    label: message.channelLabel,
    description: `${message.authorName} · ${message.text}`,
  }));
}

/** Slack messages for the composer's `#` menu. Slack needs a word to search, so nothing preloads. */
export function useComposerSlackItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = (query: string) => slackEnvironment.messages({ environmentId, input: { query } });
  return useComposerReferenceSearch({
    ...input,
    debounceMs: SLACK_SEARCH_DEBOUNCE_MS,
    limit: SLACK_RESULT_LIMIT,
    searchesEmptyQuery: false,
    atomFor,
    toItems,
  });
}
