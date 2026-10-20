import type { DiscordMessageSummary, EnvironmentId } from "@t3tools/contracts";

import { discordEnvironment } from "~/state/discord";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// Each search reads every server the bot is in, so the `#` query settles longer than pull requests do.
const DISCORD_SEARCH_DEBOUNCE_MS = 400;
const DISCORD_RESULT_LIMIT = 20;

function toItems(data: { readonly messages: ReadonlyArray<DiscordMessageSummary> }) {
  return data.messages.map((message): ComposerReferenceItem => ({
    id: `discord-message:${message.url}`,
    type: "discord-message",
    message,
    label: message.channelLabel,
    description: `${message.authorName} · ${message.text}`,
  }));
}

/** Discord messages for the composer's `#` menu. Discord needs a word to search, so nothing preloads. */
export function useComposerDiscordItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = (query: string) =>
    discordEnvironment.messages({ environmentId, input: { query } });
  return useComposerReferenceSearch({
    ...input,
    debounceMs: DISCORD_SEARCH_DEBOUNCE_MS,
    limit: DISCORD_RESULT_LIMIT,
    searchesEmptyQuery: false,
    atomFor,
    toItems,
  });
}
