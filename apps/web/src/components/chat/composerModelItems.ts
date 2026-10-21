import type { ProviderInstanceId, ServerProviderModel } from "@t3tools/contracts";

import type { AppModelOption } from "~/modelSelection";
import { providerModelKey } from "~/modelOrdering";
import { isProviderInstancePickerVisible, type ProviderInstanceEntry } from "~/providerInstances";

import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { rankModelPickerSearch } from "./modelPickerSearch";

export type ComposerModelItem = Extract<ComposerCommandItem, { type: "model" }>;

const EMPTY_ITEMS: ReadonlyArray<ComposerModelItem> = [];
const MODEL_MENU_RESULT_LIMIT = 60;

/**
 * Fork: the `@` menu's Models tab: every model the composer's model picker offers, ranked the
 * same way, optionally narrowed to one provider instance. `prefersModels` is set when the typed
 * query starts a word of a model's name, so `@grok` and `@opus` open on the Models tab.
 */
export function deriveComposerModelItems(input: {
  enabled: boolean;
  query: string;
  entries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  favoriteKeys: ReadonlySet<string>;
  instanceFilter: ProviderInstanceId | null;
}): {
  items: ReadonlyArray<ComposerModelItem>;
  instances: ReadonlyArray<ProviderInstanceEntry>;
  prefersModels: boolean;
} {
  if (!input.enabled) return { items: EMPTY_ITEMS, instances: [], prefersModels: false };
  const all: ComposerModelItem[] = [];
  const instances: ProviderInstanceEntry[] = [];
  for (const entry of input.entries) {
    if (!isProviderInstancePickerVisible(entry)) continue;
    const options = (input.modelOptionsByInstance.get(entry.instanceId) ?? []).filter(
      (option) => !option.isUnavailable,
    );
    if (options.length === 0) continue;
    instances.push(entry);
    if (input.instanceFilter !== null && entry.instanceId !== input.instanceFilter) continue;
    for (const option of options) {
      const model = entry.models.find((candidate) => candidate.slug === option.slug);
      all.push(modelItem(entry, option, model ?? null, input.favoriteKeys));
    }
  }
  const query = input.query.trim();
  const ranked =
    query.length === 0
      ? all.toSorted((a, b) => Number(b.isFavorite) - Number(a.isFavorite))
      : rankModelPickerSearch(all, query, (item) => ({
          driverKind: item.entry.driverKind,
          providerDisplayName: item.entry.displayName,
          name: item.option.name,
          ...(item.option.shortName ? { shortName: item.option.shortName } : {}),
          ...(item.option.subProvider ? { subProvider: item.option.subProvider } : {}),
          isFavorite: item.isFavorite,
        }));
  const needle = query.toLowerCase();
  return {
    items: ranked.slice(0, MODEL_MENU_RESULT_LIMIT),
    instances,
    prefersModels:
      needle.length > 0 &&
      all.some((item) =>
        [item.option.name, item.option.shortName, item.option.slug].some((name) =>
          name
            ?.toLowerCase()
            .split(/[\s_-]+/)
            .some((word) => word.startsWith(needle)),
        ),
      ),
  };
}

function modelItem(
  entry: ProviderInstanceEntry,
  option: AppModelOption,
  model: ServerProviderModel | null,
  favoriteKeys: ReadonlySet<string>,
): ComposerModelItem {
  return {
    id: `model:${entry.instanceId}:${option.slug}`,
    type: "model",
    entry,
    option,
    model,
    isFavorite: favoriteKeys.has(providerModelKey(entry.instanceId, option.slug)),
    label: option.shortName ?? option.name,
    description: entry.displayName,
  };
}
