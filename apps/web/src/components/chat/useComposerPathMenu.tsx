import {
  composerPathChatItems,
  resolveComposerPathTab,
  type ComposerPathTab,
} from "./composerPathMenu";
import { useState } from "react";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ComposerTrigger } from "../../composer-logic";
import { useEnvironmentModelPreferences } from "~/hooks/useSettings";
import { providerModelKey } from "~/modelOrdering";
import type { ProviderInstanceEntry } from "~/providerInstances";
import type { AppModelOption } from "../../modelSelection";
import type { ChatComposerProps } from "./ChatComposer";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { ComposerModelFilters } from "./ComposerModelFilters";
import { deriveComposerModelItems } from "./composerModelItems";
import { useComposerAgentItems } from "./useComposerAgentItems";

/** Fork: the `@` menu's tabs. Agents shows only when the thread has agents. */
const PATH_MENU_TABS: ReadonlyArray<{ id: ComposerPathTab; label: string }> = [
  { id: "files", label: "Files" },
  { id: "chats", label: "Chats" },
  { id: "agents", label: "Agents" },
  { id: "models", label: "Models" },
];

export function useComposerPathMenu(
  input: Pick<
    ChatComposerProps,
    | "environmentId"
    | "routeThreadRef"
    | "activeThreadId"
    | "threadTabGroup"
    | "isServerThread"
    | "gitCwd"
  > & {
    composerTrigger: ComposerTrigger | null;
    composerMenuItemsFromTrigger: ComposerCommandItem[];
    isTriggerMenuLoading: boolean;
    providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
    modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
    emptyState: string;
  },
) {
  const {
    environmentId,
    routeThreadRef,
    activeThreadId,
    threadTabGroup,
    isServerThread,
    gitCwd,
    composerTrigger,
    composerMenuItemsFromTrigger,
    isTriggerMenuLoading,
    providerInstanceEntries,
    modelOptionsByInstance,
    emptyState,
  } = input;
  const isPathTrigger = composerTrigger?.kind === "path";
  const pathTriggerQuery = isPathTrigger ? composerTrigger.query : "";
  // Fork: the `@` menu splits files from chats. Files lists workspace paths only; Chats lists
  // this thread's other chat tabs, then other threads by recency.
  const fileMenuItems = isPathTrigger
    ? composerMenuItemsFromTrigger.filter((item) => item.type === "path")
    : [];
  const chatMenuItems = isPathTrigger
    ? composerPathChatItems({
        query: pathTriggerQuery,
        threadTabs: threadTabGroup?.tabs ?? [],
        activeThreadId,
        items: composerMenuItemsFromTrigger,
      })
    : [];
  // A draft has no agents, and its thread does not exist on the server yet.
  const agentMenu = useComposerAgentItems(
    routeThreadRef,
    isPathTrigger && isServerThread,
    pathTriggerQuery,
    gitCwd,
  );
  const { favorites: favoriteModels } = useEnvironmentModelPreferences(environmentId);
  const [modelFilterChoice, setModelFilterChoice] = useState<{
    rangeStart: number;
    instanceId: ProviderInstanceId | null;
  } | null>(null);
  const modelInstanceFilter =
    isPathTrigger && modelFilterChoice?.rangeStart === composerTrigger.rangeStart
      ? modelFilterChoice.instanceId
      : null;
  const modelMenu = deriveComposerModelItems({
    enabled: isPathTrigger,
    query: pathTriggerQuery,
    entries: providerInstanceEntries,
    modelOptionsByInstance,
    favoriteKeys: new Set(
      favoriteModels.map((favorite) => providerModelKey(favorite.provider, favorite.model)),
    ),
    instanceFilter: modelInstanceFilter,
  });
  // A tab picked by hand holds until this `@` token closes; otherwise the query picks it:
  // Agents for a handle, Models for a model name, Chats when only chats match, else Files.
  const [pathTabChoice, setPathTabChoice] = useState<{
    rangeStart: number;
    tab: ComposerPathTab;
  } | null>(null);
  const pathTab = resolveComposerPathTab({
    rangeStart: isPathTrigger ? composerTrigger.rangeStart : null,
    choice: pathTabChoice,
    agentsAvailable: agentMenu.available,
    prefersAgents: agentMenu.prefersAgents,
    prefersModels: modelMenu.prefersModels,
    query: pathTriggerQuery,
    chatCount: chatMenuItems.length,
    fileCount: fileMenuItems.length,
    filesLoading: isTriggerMenuLoading,
  });
  const items = !isPathTrigger
    ? composerMenuItemsFromTrigger
    : pathTab === "models"
      ? [...modelMenu.items]
      : pathTab === "agents"
        ? [...agentMenu.items]
        : pathTab === "chats"
          ? chatMenuItems
          : fileMenuItems;
  return {
    items,
    isLoading: isTriggerMenuLoading && (!isPathTrigger || pathTab === "files"),
    menuProps: {
      emptyStateText:
        isPathTrigger && pathTab === "agents"
          ? pathTriggerQuery
            ? `No agent matches ${pathTriggerQuery}.`
            : "This thread has no agents."
          : isPathTrigger && pathTab === "models"
            ? pathTriggerQuery
              ? `No model matches ${pathTriggerQuery}.`
              : "No models available."
            : isPathTrigger && pathTab === "chats"
              ? pathTriggerQuery
                ? `No chat matches ${pathTriggerQuery}.`
                : "No other chats yet."
              : emptyState,
      ...(isPathTrigger
        ? {
            tabs: {
              options: agentMenu.available
                ? PATH_MENU_TABS
                : PATH_MENU_TABS.filter((tab) => tab.id !== "agents"),
              activeId: pathTab,
              onSelect: (id: string) => {
                const tab = PATH_MENU_TABS.find((option) => option.id === id);
                if (!tab) return;
                setPathTabChoice({
                  rangeStart: composerTrigger.rangeStart,
                  tab: tab.id,
                });
              },
            },
            ...(pathTab === "models"
              ? {
                  filters: (
                    <ComposerModelFilters
                      instances={modelMenu.instances}
                      selected={modelInstanceFilter}
                      onSelect={(instanceId) =>
                        setModelFilterChoice({
                          rangeStart: composerTrigger.rangeStart,
                          instanceId,
                        })
                      }
                    />
                  ),
                }
              : {}),
          }
        : {}),
    },
  };
}
