import {
  configuredContextRepositoryOwners,
  describeContextRepositoryOwners,
} from "@t3tools/client-runtime/context-repositories";
import type { EnvironmentId, ProjectId, ThreadPullRequestLink } from "@t3tools/contracts";
import { useState } from "react";

import type { ComposerTrigger } from "../../composer-logic";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useComposerReferenceRecents } from "./composerReferenceRecents";
import {
  type ComposerReferenceItem,
  type ComposerReferenceTab,
  composerReferenceTabForItem,
  orderComposerReferenceItems,
  predictComposerReferenceTab,
} from "./composerReferenceMenu.logic";
import { useComposerCheckoutItems } from "./useComposerCheckoutItems";
import { useComposerDiscordItems } from "./useComposerDiscordItems";
import { useComposerGitHubIssueItems } from "./useComposerGitHubIssueItems";
import { useComposerGranolaItems } from "./useComposerGranolaItems";
import { useComposerLinearIssueItems } from "./useComposerLinearIssueItems";
import { useComposerNotionItems } from "./useComposerNotionItems";
import { useComposerGoogleItems } from "./useComposerGoogleItems";
import { useComposerPullRequestItems } from "./useComposerPullRequestItems";
import { useComposerReferenceSources } from "./useComposerReferenceSources";
import { useComposerRepositoryItems } from "./useComposerRepositoryItems";
import { useComposerSlackItems } from "./useComposerSlackItems";

const REFERENCE_MENU_TABS: ReadonlyArray<{
  id: ComposerReferenceTab;
  label: string;
}> = [
  { id: "checkouts", label: "Checkouts" },
  { id: "pull-requests", label: "Pull requests" },
  { id: "github-issues", label: "GitHub issues" },
  { id: "linear-issues", label: "Linear issues" },
  { id: "slack-messages", label: "Slack" },
  { id: "discord-messages", label: "Discord" },
  { id: "notion-pages", label: "Notion" },
  { id: "google-files", label: "Google" },
  { id: "granola-notes", label: "Granola" },
  { id: "repositories", label: "Repositories" },
];
const REFERENCE_MENU_RESULT_LIMIT = 20;
const EMPTY_REFERENCE_MENU_ITEMS: ReadonlyArray<ComposerReferenceItem> = [];

/**
 * Fork: the `#` menu's tabs. Kept out of ChatComposer so upstream syncs, which rewrite the
 * composer, have less to carry over.
 */
export function useComposerReferenceMenu(input: {
  readonly environmentId: EnvironmentId;
  readonly trigger: ComposerTrigger | null;
  readonly projectId: ProjectId | null;
  readonly repository: string | null;
  /** Repositories the thread references, so `#123` also resolves their pull requests. */
  readonly remoteUrls: ReadonlyArray<string>;
  readonly threadPullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly githubIssueCwd: string | null;
}) {
  const { environmentId, trigger } = input;
  const open = trigger?.kind === "pull-request";
  const query = open ? trigger.query : "";
  // A tab picked by hand holds until this `#` token closes; otherwise the query picks it.
  const [tabChoice, setTabChoice] = useState<{
    rangeStart: number;
    tab: ComposerReferenceTab;
  } | null>(null);
  const defaultRepositoryOwners = useEnvironmentSettings(
    environmentId,
    configuredContextRepositoryOwners,
  );
  const sources = useComposerReferenceSources(environmentId, open);
  const recents = useComposerReferenceRecents(environmentId, input.projectId);
  const available = new Set<ComposerReferenceTab>(
    REFERENCE_MENU_TABS.flatMap((tab) =>
      (tab.id === "linear-issues" && !sources.linear) ||
      (tab.id === "notion-pages" && !sources.notion) ||
      (tab.id === "google-files" && !sources.google) ||
      (tab.id === "granola-notes" && !sources.granola) ||
      (tab.id === "slack-messages" && !sources.slack) ||
      (tab.id === "discord-messages" && !sources.discord) ||
      (tab.id === "github-issues" && input.githubIssueCwd === null)
        ? []
        : [tab.id],
    ),
  );
  const tabs = REFERENCE_MENU_TABS.filter((tab) => available.has(tab.id));
  const tabPickedByHand =
    open && tabChoice?.rangeStart === trigger.rangeStart ? tabChoice.tab : null;
  // Every available tab preloads its empty-query rows while `#` is open; only the visible tab
  // searches the typed query.
  const [predictedTab, setPredictedTab] = useState<ComposerReferenceTab>("pull-requests");
  const tab: ComposerReferenceTab = open ? (tabPickedByHand ?? predictedTab) : "pull-requests";

  const pullRequestMenu = useComposerPullRequestItems({
    environmentId,
    projectId: input.projectId,
    repository: input.repository,
    remoteUrls: input.remoteUrls,
    pullRequests: input.threadPullRequests,
    enabled: open,
    active: tab === "pull-requests",
    query,
  });
  const linearIssueMenu = useComposerLinearIssueItems(environmentId, {
    enabled: available.has("linear-issues"),
    active: tab === "linear-issues",
    query,
  });
  const notionMenu = useComposerNotionItems(environmentId, {
    enabled: available.has("notion-pages"),
    active: tab === "notion-pages",
    query,
  });
  const googleMenu = useComposerGoogleItems(environmentId, {
    enabled: available.has("google-files"),
    active: tab === "google-files",
    query,
  });
  const granolaMenu = useComposerGranolaItems(environmentId, {
    enabled: available.has("granola-notes"),
    active: tab === "granola-notes",
    query,
  });
  const slackMenu = useComposerSlackItems(environmentId, {
    enabled: available.has("slack-messages"),
    active: tab === "slack-messages",
    query,
  });
  const discordMenu = useComposerDiscordItems(environmentId, {
    enabled: available.has("discord-messages"),
    active: tab === "discord-messages",
    query,
  });
  const githubIssueMenu = useComposerGitHubIssueItems(environmentId, input.githubIssueCwd, {
    enabled: open,
    active: tab === "github-issues",
    query,
  });
  const repositoryMenu = useComposerRepositoryItems(environmentId, defaultRepositoryOwners, {
    enabled: open,
    active: tab === "repositories",
    query,
  });
  const checkoutMenu = useComposerCheckoutItems(environmentId, {
    enabled: open,
    query: tab === "checkouts" ? query : "",
  });

  const nextPredictedTab = open
    ? predictComposerReferenceTab({
        query,
        available,
        hasDefaultRepositoryOwner: defaultRepositoryOwners.length > 0,
        recents,
        preloaded: {
          "pull-requests": pullRequestMenu.preloaded,
          "linear-issues": linearIssueMenu.preloaded,
          "github-issues": githubIssueMenu.preloaded,
          "notion-pages": notionMenu.preloaded,
          "google-files": googleMenu.preloaded,
          "granola-notes": granolaMenu.preloaded,
          checkouts: checkoutMenu.preloaded,
        },
      })
    : "pull-requests";
  // Predicted from rows the tabs load, so it settles one render after they arrive.
  if (nextPredictedTab !== predictedTab) {
    setPredictedTab(nextPredictedTab);
  }

  const active = (() => {
    switch (tab) {
      case "linear-issues":
        return {
          items: linearIssueMenu.items,
          isPending: linearIssueMenu.isPending,
          loadingText: "Searching Linear issues...",
          emptyState:
            linearIssueMenu.error ??
            (query
              ? `No Linear issue matches ${query}.`
              : "No open Linear issues are assigned to you."),
        };
      case "notion-pages":
        return {
          items: notionMenu.items,
          isPending: notionMenu.isPending,
          emptyState: notionMenu.error ?? "No Notion pages found. Try searching by title.",
        };
      case "google-files":
        return {
          items: googleMenu.items,
          isPending: googleMenu.isPending,
          emptyState: googleMenu.error ?? "No Google sources found. Try another search.",
        };
      case "granola-notes":
        return {
          items: granolaMenu.items,
          isPending: granolaMenu.isPending,
          emptyState:
            granolaMenu.error ??
            "No meetings in the last 30 days match. Paste a note link to attach an older one.",
        };
      case "slack-messages":
        return {
          items: slackMenu.items,
          isPending: slackMenu.isPending,
          loadingText: "Searching Slack...",
          emptyState:
            slackMenu.error ??
            (query ? `No Slack message matches ${query}.` : "Type a word to search Slack."),
        };
      case "discord-messages":
        return {
          items: discordMenu.items,
          isPending: discordMenu.isPending,
          loadingText: "Searching Discord...",
          emptyState:
            discordMenu.error ??
            (query ? `No Discord message matches ${query}.` : "Type a word to search Discord."),
        };
      case "github-issues":
        return {
          items: githubIssueMenu.items,
          isPending: githubIssueMenu.isPending,
          loadingText: "Searching GitHub issues...",
          emptyState:
            githubIssueMenu.error ??
            (query
              ? `No GitHub issue matches ${query}.`
              : "No open GitHub issues in this repository."),
        };
      case "repositories":
        return {
          items: repositoryMenu.items,
          isPending: repositoryMenu.isPending,
          loadingText: "Listing repositories...",
          emptyState:
            repositoryMenu.owners.length === 0
              ? "Type an owner like #acme/ to list its repositories, or add repository owners in Settings."
              : (repositoryMenu.error ??
                `No repositories in ${describeContextRepositoryOwners(repositoryMenu.owners)} match.`),
        };
      case "checkouts":
        return {
          items: checkoutMenu.items,
          isPending: checkoutMenu.isPending,
          loadingText: "Looking up checkouts...",
          hint: "Enter references. Command-Enter also links it to the thread.",
          emptyState:
            checkoutMenu.error ??
            (query
              ? `No checkout matches ${query}. Paste a path to use another folder.`
              : "No local checkouts yet. Paste a path to add one."),
        };
      case "pull-requests":
        return {
          items: pullRequestMenu.items,
          isPending: pullRequestMenu.isPending,
          emptyState: !pullRequestMenu.available
            ? "Pull requests are not available for this project."
            : pullRequestMenu.failed
              ? "Pull requests could not be read for this project."
              : query
                ? `No pull request matches ${query}.`
                : "No pull requests found in this repository.",
        };
    }
  })();
  const items = open
    ? orderComposerReferenceItems({
        items: active.items,
        recents: recents.filter((item) => composerReferenceTabForItem(item) === tab),
        query,
        limit: REFERENCE_MENU_RESULT_LIMIT,
      })
    : EMPTY_REFERENCE_MENU_ITEMS;

  return {
    open,
    items,
    tab,
    /** Hidden when only one tab is available. */
    tabs: tabs.length > 1 ? tabs : null,
    chooseTab: (id: string) => {
      if (!open) return;
      setTabChoice({
        rangeStart: trigger.rangeStart,
        tab: tabs.find((option) => option.id === id)?.id ?? "pull-requests",
      });
    },
    isLoading: open && active.isPending,
    emptyState: active.emptyState,
    loadingText: "loadingText" in active ? active.loadingText : undefined,
    hint: "hint" in active ? active.hint : undefined,
  };
}
