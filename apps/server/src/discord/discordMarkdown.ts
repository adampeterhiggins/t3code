import * as DateTime from "effect/DateTime";

/** Discord ids count milliseconds from the first second of 2015 in their top 42 bits. */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

export function snowflakeToMillis(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

/** The smallest id Discord could give a message posted at `ms`, for `min_id` searches. */
export function millisToSnowflake(ms: number): string {
  return (
    (BigInt(Math.max(Math.floor(ms), 1_420_070_400_000)) - DISCORD_EPOCH_MS) <<
    22n
  ).toString();
}

/** `2026-09-29 10:47 UTC`, the time a message header shows. */
export function discordTimeToDisplay(iso: string): string {
  const formatted = DateTime.formatIso(DateTime.makeUnsafe(iso));
  return `${formatted.slice(0, 10)} ${formatted.slice(11, 16)} UTC`;
}

export interface DiscordNames {
  readonly users: ReadonlyMap<string, string>;
  readonly channels: ReadonlyMap<string, string>;
}

/**
 * Discord content is already markdown; only its angle-bracket tokens (user, channel and role
 * mentions, custom emoji, timestamps) need turning into what a reader sees.
 */
export function discordContentToMarkdown(content: string, names: DiscordNames): string {
  return content.replace(
    /<(@!?|#|@&|a?:[\w~]+:|t:)(\d+)(?::[tTdDfFR])?>/g,
    (token, kind: string, id: string) => {
      if (kind === "@" || kind === "@!") return `@${names.users.get(id) ?? id}`;
      if (kind === "#") return `#${names.channels.get(id) ?? id}`;
      if (kind === "@&") return "@role";
      if (kind === "t:") {
        const seconds = Number(id);
        return Number.isSafeInteger(seconds)
          ? discordTimeToDisplay(DateTime.formatIso(DateTime.makeUnsafe(seconds * 1_000)))
          : token;
      }
      return `:${kind.split(":")[1]}:`;
    },
  );
}

/** The user, role and channel mentions `content` shows once converted, for highlighting. */
export function discordMentionLabels(content: string, names: DiscordNames): ReadonlyArray<string> {
  const tokens = content.matchAll(/<(?:@!?|#|@&)\d+>/g);
  return [...new Set([...tokens].map((match) => discordContentToMarkdown(match[0], names)))];
}

/** The channel ids `content` mentions, for resolving their names. */
export function mentionedChannelIds(content: string): ReadonlyArray<string> {
  return [...content.matchAll(/<#(\d+)>/g)].map((match) => match[1]!);
}
