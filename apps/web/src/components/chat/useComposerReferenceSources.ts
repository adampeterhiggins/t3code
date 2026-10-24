import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { discordEnvironment } from "~/state/discord";
import { granolaEnvironment } from "~/state/granola";
import { linearEnvironment } from "~/state/linear";
import { notionEnvironment } from "~/state/notion";
import { googleEnvironment } from "~/state/google";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";

/**
 * Which connected services the `#` menu can search. Connections are only watched while `#` is
 * open, so the composer does not subscribe to services the user is not reaching for.
 */
export function useComposerReferenceSources(environmentId: EnvironmentId, open: boolean) {
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const discordEnabled = useEnvironmentSettings(environmentId, (s) => s.enableDiscordIntegration);
  const notionEnabled = useEnvironmentSettings(environmentId, (s) => s.enableNotionIntegration);
  const googleEnabled = useEnvironmentSettings(environmentId, (s) => s.enableGoogleIntegration);
  const granolaEnabled = useEnvironmentSettings(environmentId, (s) => s.enableGranolaIntegration);
  const linear = useEnvironmentQuery(
    open ? linearEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const slack = useEnvironmentQuery(
    open && slackEnabled ? slackEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const discord = useEnvironmentQuery(
    open && discordEnabled ? discordEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const notion = useEnvironmentQuery(
    open && notionEnabled ? notionEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const google = useEnvironmentQuery(
    open && googleEnabled ? googleEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const granola = useEnvironmentQuery(
    open && granolaEnabled ? granolaEnvironment.connection({ environmentId, input: {} }) : null,
  );
  return {
    linear: open && linear.data?.phase === "connected",
    slack: open && slackEnabled && slack.data?.phase === "connected",
    discord: open && discordEnabled && discord.data?.phase === "connected",
    notion: open && notionEnabled && notion.data?.phase === "connected",
    google: open && googleEnabled && google.data?.phase === "connected",
    granola: open && granolaEnabled && granola.data?.phase === "connected",
  };
}
