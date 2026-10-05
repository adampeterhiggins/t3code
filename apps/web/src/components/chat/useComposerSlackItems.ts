import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ComposerTrigger } from "~/composer-logic";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

// Slack search is rate-limited per minute, so the `#` query settles longer than pull requests do.
const SLACK_SEARCH_DEBOUNCE_MS = 400;
const SLACK_RESULT_LIMIT = 20;

/**
 * Slack messages for the composer's `#` menu, on their own tab. The tab only shows once Slack is
 * connected, and only searches while it is visible, which keeps typing within Slack's limit.
 */
export function useComposerSlackItems(
  environmentId: EnvironmentId,
  trigger: ComposerTrigger | null,
  active: boolean,
) {
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const connection = useEnvironmentQuery(
    slackEnabled && trigger?.kind === "pull-request"
      ? slackEnvironment.connection({ environmentId, input: {} })
      : null,
  );
  const enabled =
    slackEnabled && trigger?.kind === "pull-request" && connection.data?.phase === "connected";
  const query = enabled && active && trigger.query.length > 0 ? trigger.query : null;
  const debouncedQuery = useDebouncedValue(query, SLACK_SEARCH_DEBOUNCE_MS);
  const settledQuery = query === debouncedQuery ? query : null;
  const messages = useEnvironmentQuery(
    settledQuery === null
      ? null
      : slackEnvironment.messages({ environmentId, input: { query: settledQuery } }),
  );
  const items = useMemo<ComposerCommandItem[]>(
    () =>
      settledQuery === null
        ? []
        : (messages.data?.messages ?? []).slice(0, SLACK_RESULT_LIMIT).map((message) => ({
            id: `slack-message:${message.url}`,
            type: "slack-message",
            message,
            label: message.channelLabel,
            description: `${message.authorName} · ${message.text}`,
          })),
    [messages.data, settledQuery],
  );
  return {
    enabled,
    items,
    error: messages.error,
    isPending: query !== null && (query !== debouncedQuery || messages.isPending),
  };
}
