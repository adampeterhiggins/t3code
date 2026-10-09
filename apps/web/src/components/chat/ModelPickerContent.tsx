import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { useAtomValue } from "@effect/atom-react";
import { formatProviderUpdateRequiredNotice } from "@t3tools/client-runtime/providerUpdateRequiredModels";
import { useNavigate } from "@tanstack/react-router";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ChevronRightIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { getProviderStatusMessage, hasProviderSetup } from "./ProviderStatusBanner";
import {
  modelPickerLegacySectionKey,
  modelPickerModelKey,
  parseModelPickerLegacySectionKey,
  parseModelPickerModelKey,
} from "./modelPickerKeys";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxListVirtualized,
} from "../ui/combobox";
import { ModelEsque } from "./providerIconUtils";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { getVirtualizedScrollFadeClassName } from "../ui/scroll-area";
import { TooltipProvider } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import {
  dedupeModelPickerItemsByDriverSlug,
  isDriverModelFavorite,
  providerBrandLabel,
  resolveInstanceForModelSelection,
  uniqueProviderRailEntries,
} from "./providerAccountSelection";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  badge?: "new";
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  continuationGroupKey?: string | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

export function resolveModelPickerSelectedModel(input: {
  driverKind: ProviderDriverKind | undefined;
  model: string;
  options: ReadonlyArray<ModelEsque>;
}) {
  if (input.driverKind === "antigravity" && input.model === ANTIGRAVITY_DEFAULT_MODEL) {
    const availableModels = input.options.filter(
      (option) => option.slug !== ANTIGRAVITY_DEFAULT_MODEL && !option.isUnavailable,
    );
    return (
      availableModels.find((option) => option.aliases?.includes(ANTIGRAVITY_DEFAULT_MODEL)) ??
      availableModels.find((option) => option.isDefault)
    );
  }
  return input.options.find((option) => option.slug === input.model);
}

export function shouldIncludeModelPickerOption(input: {
  readonly entry: ProviderInstanceEntry;
  readonly option: ModelEsque;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
}): boolean {
  if (input.entry.driverKind === "antigravity" && input.option.slug === ANTIGRAVITY_DEFAULT_MODEL) {
    return false;
  }
  if (isProviderInstancePickerReady(input.entry)) return true;
  return (
    input.entry.enabled &&
    (input.entry.driverKind === "opencode" || input.entry.driverKind === "antigravity") &&
    input.entry.instanceId === input.activeInstanceId &&
    input.option.slug === input.activeModel &&
    input.option.isUnavailable === true
  );
}

export function shouldOfferModelPickerSetup(
  entry: ProviderInstanceEntry,
  options: ReadonlyArray<ModelEsque>,
): boolean {
  return (
    entry.enabled &&
    entry.status !== "disabled" &&
    hasProviderSetup(entry.snapshot) &&
    (!isProviderInstancePickerReady(entry) ||
      !entry.installed ||
      entry.snapshot.auth.status === "unauthenticated" ||
      !options.some((option) => !option.isUnavailable))
  );
}

export function adjacentModelPickerProvider(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  selectedDriverKind: ProviderDriverKind | "favorites";
  direction: 1 | -1;
  disabledDriverKinds: ReadonlySet<ProviderDriverKind> | undefined;
  selectableUnavailableDriverKinds: ReadonlySet<ProviderDriverKind> | undefined;
}) {
  const providers: Array<ProviderDriverKind | "favorites"> = [
    "favorites",
    ...uniqueProviderRailEntries(input.entries)
      .filter(
        (entry) =>
          !input.disabledDriverKinds?.has(entry.driverKind) &&
          (isProviderInstancePickerReady(entry) ||
            input.selectableUnavailableDriverKinds?.has(entry.driverKind)),
      )
      .map((entry) => entry.driverKind),
  ];
  const index = providers.indexOf(input.selectedDriverKind);
  return providers[
    index < 0
      ? input.direction === 1
        ? 0
        : providers.length - 1
      : (index + input.direction + providers.length) % providers.length
  ]!;
}

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();
const MODEL_LIST_ESTIMATED_ITEM_SIZE = 52;

/**
 * Whether a started thread can move to this instance in place. Outside the lock, the picker
 * either hides the instance or, when forking is available, opens it in a new tab.
 */
export function matchesModelPickerLock(input: {
  entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey: string | null;
}): boolean {
  if (input.lockedProvider === null) return true;
  if (input.entry.driverKind !== input.lockedProvider) return false;
  if (!input.lockedContinuationGroupKey) return true;
  return input.entry.continuationGroupKey === input.lockedContinuationGroupKey;
}

function ModelListSeparator() {
  return <div className="h-0.5" />;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  /** The instance currently selected in the composer (combobox "value"). */
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  /**
   * When set, the picker is locked to the given driver kind — typically
   * because the user is editing a previously-sent message and can't change
   * which driver served the turn. Multiple instances of the same kind
   * remain selectable (e.g. locked to `codex` still lets the user switch
   * between the default Codex and a custom Codex Personal).
   */
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /**
   * All configured provider instances in display order. Used to render
   * the sidebar (one button per instance) and to resolve display names
   * for the locked-mode header.
   */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  /**
   * Model options per instance. Keyed by `ProviderInstanceId` so the
   * default Codex instance and any custom Codex instances each have their
   * own list (custom instances typically start with the same built-in
   * model set but are free to diverge via customModels).
   */
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /**
   * Opens the model in a new tab of the thread. When set, the provider lock stops hiding other
   * providers: their models, and any `modelRequiresFork` reports, can only be opened with the
   * row's fork button, while models the thread can switch to also offer forking on hover.
   */
  onForkModel?: (instanceId: ProviderInstanceId, model: string) => void;
  modelRequiresFork?: (instanceId: ProviderInstanceId, model: string) => boolean;
}) {
  const {
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
    onToggleModel,
    onForkModel,
    modelRequiresFork,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<LegendListRef | null>(null);
  const pickerContentRef = useRef<HTMLDivElement>(null);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const favorites = useClientSettings((s) => s.favorites ?? []);
  const activeEntry = props.instanceEntries.find(
    (entry) => entry.instanceId === props.activeInstanceId,
  );
  const activeModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: props.model,
    options: modelOptionsByInstance.get(props.activeInstanceId) ?? [],
  });
  const activeModelSlug =
    activeModel?.slug ?? (props.model === ANTIGRAVITY_DEFAULT_MODEL ? "" : props.model);
  const activeModelKey = activeModelSlug
    ? modelPickerModelKey(props.activeInstanceId, activeModelSlug)
    : null;
  const selectedModelKeys = useMemo(
    () =>
      props.selectedModels?.map((selection) => {
        const entry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
        const model = resolveModelPickerSelectedModel({
          driverKind: entry?.driverKind,
          model: selection.model,
          options: modelOptionsByInstance.get(selection.instanceId) ?? [],
        });
        return modelPickerModelKey(selection.instanceId, model?.slug ?? selection.model);
      }),
    [instanceEntries, modelOptionsByInstance, props.selectedModels],
  );
  const isCollapsedModelSelected = useCallback(
    (model: Pick<ModelPickerItem, "driverKind" | "slug" | "instanceId">) => {
      if (props.selectedModels) {
        return props.selectedModels.some((selection) => {
          const entry = instanceEntries.find(
            (candidate) => candidate.instanceId === selection.instanceId,
          );
          if (!entry || entry.driverKind !== model.driverKind) return false;
          const resolved = resolveModelPickerSelectedModel({
            driverKind: entry.driverKind,
            model: selection.model,
            options: modelOptionsByInstance.get(selection.instanceId) ?? [],
          });
          return (resolved?.slug ?? selection.model) === model.slug;
        });
      }
      return activeEntry?.driverKind === model.driverKind && activeModelSlug === model.slug;
    },
    [
      activeEntry?.driverKind,
      activeModelSlug,
      instanceEntries,
      modelOptionsByInstance,
      props.selectedModels,
    ],
  );
  const activeInstanceHasSelectableUnavailableModel =
    activeEntry !== undefined &&
    (modelOptionsByInstance.get(props.activeInstanceId) ?? []).some((option) =>
      shouldIncludeModelPickerOption({
        entry: activeEntry,
        option,
        activeInstanceId: props.activeInstanceId,
        activeModel: activeModelSlug,
      }),
    ) &&
    !isProviderInstancePickerReady(activeEntry);
  const activeInstanceNeedsSetup =
    props.onOpenProviderSetup !== undefined &&
    activeEntry !== undefined &&
    shouldOfferModelPickerSetup(
      activeEntry,
      modelOptionsByInstance.get(props.activeInstanceId) ?? [],
    );
  const [selectedDriverKind, setSelectedDriverKind] = useState<ProviderDriverKind | "favorites">(
    () => {
      if (
        props.lockedProvider !== null ||
        activeInstanceHasSelectableUnavailableModel ||
        activeInstanceNeedsSetup
      ) {
        // Keep the active provider visible when it is locked or needs setup.
        return activeEntry?.driverKind ?? props.lockedProvider ?? "favorites";
      }
      return favorites.length > 0 ? "favorites" : (activeEntry?.driverKind ?? "favorites");
    },
  );
  const [expandedLegacyDrivers, setExpandedLegacyDrivers] = useState(
    () =>
      new Set<ProviderDriverKind>(
        modelOptionsByInstance
          .get(props.activeInstanceId)
          ?.some((model) => model.slug === activeModelSlug && model.isLegacy) && activeEntry
          ? [activeEntry.driverKind]
          : [],
      ),
  );
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = providedKeybindings ?? serverKeybindings;
  const updateSettings = useUpdateClientSettings();
  const navigate = useNavigate();

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectDriver = useCallback(
    (driverKind: ProviderDriverKind | "favorites") => {
      setSelectedDriverKind(driverKind);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  useLayoutEffect(() => {
    focusSearchInput();
    const frame = window.requestAnimationFrame(() => {
      focusSearchInput();
    });
    const timeout = window.setTimeout(() => {
      focusSearchInput();
    }, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSearchInput]);

  // Create a Set for efficient lookup. Favorites are keyed by
  // `${instanceId}:${slug}`; the storage schema widened from ProviderDriverKind
  // to ProviderInstanceId so pre-migration favorites keyed by driver slugs
  // (e.g. `"codex:gpt-5"`) still resolve — the default instance id equals
  // the driver slug.
  const favoritesSet = useMemo(() => {
    return new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  }, [favorites]);

  /**
   * Lookup table keyed by `instanceId`. Used for display name + driver
   * kind enrichment and for `ready`/enabled filtering before flattening
   * models into the search list.
   */
  const entryByInstanceId = useMemo(
    () => new Map(instanceEntries.map((entry) => [entry.instanceId, entry])),
    [instanceEntries],
  );
  const matchesLockedProvider = useCallback(
    (entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">): boolean =>
      matchesModelPickerLock({
        entry,
        lockedProvider: props.lockedProvider,
        lockedContinuationGroupKey: props.lockedContinuationGroupKey ?? null,
      }),
    [props.lockedContinuationGroupKey, props.lockedProvider],
  );

  const selectableUnavailableDriverKinds = useMemo(() => {
    const driverKinds = new Set<ProviderDriverKind>();
    if (activeInstanceHasSelectableUnavailableModel && activeEntry) {
      driverKinds.add(activeEntry.driverKind);
    }
    if (props.onOpenProviderSetup) {
      for (const entry of instanceEntries) {
        if (
          shouldOfferModelPickerSetup(entry, modelOptionsByInstance.get(entry.instanceId) ?? [])
        ) {
          driverKinds.add(entry.driverKind);
        }
      }
    }
    return driverKinds.size > 0 ? driverKinds : undefined;
  }, [
    activeEntry,
    activeInstanceHasSelectableUnavailableModel,
    instanceEntries,
    modelOptionsByInstance,
    props.onOpenProviderSetup,
  ]);

  // Flatten models into a searchable array. One pass over the
  // instance-keyed map; each model carries its instance id + driver kind
  // so the list row can render the right icon and display name without
  // another lookup. Account duplicates are collapsed later.
  const flatModels = useMemo(() => {
    const out: ModelPickerItem[] = [];
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        // Instance disappeared between renders (configuration change). Skip
        // its models — stale options shouldn't appear in the picker.
        continue;
      }
      for (const model of models) {
        if (
          !shouldIncludeModelPickerOption({
            entry,
            option: model,
            activeInstanceId: props.activeInstanceId,
            activeModel: activeModelSlug,
          })
        ) {
          continue;
        }
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.badge ? { badge: model.badge } : {}),
          ...(model.isLegacy ? { isLegacy: true } : {}),
          ...(model.isUnavailable ? { isUnavailable: true } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: providerBrandLabel(entry.driverKind),
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.acpRegistryAgentId ? { acpRegistryAgentId: entry.acpRegistryAgentId } : {}),
          ...(entry.acpRegistryIconUrl ? { acpRegistryIconUrl: entry.acpRegistryIconUrl } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return dedupeModelPickerItemsByDriverSlug(out, {
      entries: instanceEntries,
      modelOptionsByInstance,
      preferredInstanceId: props.activeInstanceId,
      ...(props.lockedContinuationGroupKey != null
        ? { lockedContinuationGroupKey: props.lockedContinuationGroupKey }
        : {}),
    });
  }, [
    modelOptionsByInstance,
    entryByInstanceId,
    instanceEntries,
    props.activeInstanceId,
    props.lockedContinuationGroupKey,
    activeModelSlug,
  ]);

  // With forking available, other providers stay listed and open in a new tab instead.
  const isLocked = props.lockedProvider !== null && onForkModel === undefined;
  const requiresFork = useCallback(
    (model: Pick<ModelPickerItem, "driverKind" | "continuationGroupKey" | "instanceId" | "slug">) =>
      onForkModel !== undefined &&
      (!matchesLockedProvider(model) || modelRequiresFork?.(model.instanceId, model.slug) === true),
    [matchesLockedProvider, modelRequiresFork, onForkModel],
  );
  const isSearching = searchQuery.trim().length > 0;
  const lockedDisabledDriverKinds = useMemo(() => {
    if (!isLocked) {
      return undefined;
    }
    const disabled = new Set<ProviderDriverKind>();
    for (const entry of instanceEntries) {
      if (!matchesLockedProvider(entry)) {
        disabled.add(entry.driverKind);
      }
    }
    return disabled;
  }, [instanceEntries, isLocked, matchesLockedProvider]);
  const sidebarInstanceEntries = useMemo(() => {
    const enabledEntries = uniqueProviderRailEntries(
      instanceEntries.filter(isProviderInstancePickerVisible),
    );
    if (!isLocked) {
      return enabledEntries;
    }
    const available: ProviderInstanceEntry[] = [];
    const disabled: ProviderInstanceEntry[] = [];
    for (const entry of enabledEntries) {
      if (matchesLockedProvider(entry)) {
        available.push(entry);
      } else {
        disabled.push(entry);
      }
    }
    return [...available, ...disabled];
  }, [instanceEntries, isLocked, matchesLockedProvider]);
  const showSidebar = !isSearching && sidebarInstanceEntries.length > 0;
  const instanceOrder = useMemo(
    () => instanceEntries.map((entry) => entry.instanceId),
    [instanceEntries],
  );

  // Filter models based on search query and selected provider
  const filteredModels = useMemo(() => {
    let result = flatModels;

    // Apply tokenized fuzzy search across the combined provider/model search fields.
    if (searchQuery.trim()) {
      const rankedMatches = result
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(
            {
              name: model.name,
              ...(model.shortName ? { shortName: model.shortName } : {}),
              ...(model.subProvider ? { subProvider: model.subProvider } : {}),
              driverKind: model.driverKind,
              providerDisplayName: model.instanceDisplayName,
              isFavorite: isDriverModelFavorite({
                favoritesSet,
                driverKind: model.driverKind,
                slug: model.slug,
                entries: instanceEntries,
              }),
            },
            searchQuery,
          ),
          isFavorite: isDriverModelFavorite({
            favoritesSet,
            driverKind: model.driverKind,
            slug: model.slug,
            entries: instanceEntries,
          }),
          tieBreaker: buildModelPickerSearchText({
            name: model.name,
            ...(model.shortName ? { shortName: model.shortName } : {}),
            ...(model.subProvider ? { subProvider: model.subProvider } : {}),
            driverKind: model.driverKind,
            providerDisplayName: model.instanceDisplayName,
          }),
        }))
        .filter(
          (
            rankedModel,
          ): rankedModel is {
            model: ModelPickerItem;
            score: number;
            isFavorite: boolean;
            tieBreaker: string;
          } => rankedModel.score !== null,
        );

      // When searching, we only respect locked provider (by driver kind),
      // ignoring sidebar selection so searches can find a model before the
      // user chooses a specific provider rail item.
      if (isLocked) {
        const lockedProviderMatches: Array<(typeof rankedMatches)[number]> = [];
        for (const rankedModel of rankedMatches) {
          if (matchesLockedProvider(rankedModel.model)) {
            lockedProviderMatches.push(rankedModel);
          }
        }
        return lockedProviderMatches
          .toSorted((a, b) => {
            const scoreDelta = a.score - b.score;
            if (scoreDelta !== 0) {
              return scoreDelta;
            }
            if (a.isFavorite !== b.isFavorite) {
              return a.isFavorite ? -1 : 1;
            }
            return a.tieBreaker.localeCompare(b.tieBreaker);
          })
          .map((rankedModel) => rankedModel.model);
      }

      return rankedMatches
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          if (a.isFavorite !== b.isFavorite) {
            return a.isFavorite ? -1 : 1;
          }
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    if (isLocked) {
      result = result.filter((m) => matchesLockedProvider(m));
      if (selectedDriverKind === "favorites") {
        result = result.filter((m) =>
          isDriverModelFavorite({
            favoritesSet,
            driverKind: m.driverKind,
            slug: m.slug,
            entries: instanceEntries,
          }),
        );
      } else {
        result = result.filter((m) => m.driverKind === selectedDriverKind);
      }
    } else if (selectedDriverKind === "favorites") {
      result = result.filter((m) =>
        isDriverModelFavorite({
          favoritesSet,
          driverKind: m.driverKind,
          slug: m.slug,
          entries: instanceEntries,
        }),
      );
    } else {
      result = result.filter((m) => m.driverKind === selectedDriverKind);
    }

    return sortProviderModelItems(result, {
      favoriteModelKeys: result
        .filter((model) =>
          isDriverModelFavorite({
            favoritesSet,
            driverKind: model.driverKind,
            slug: model.slug,
            entries: instanceEntries,
          }),
        )
        .map((model) => providerModelKey(model.instanceId, model.slug)),
      groupFavorites: selectedDriverKind !== "favorites",
      instanceOrder: selectedDriverKind === "favorites" ? instanceOrder : [],
    });
  }, [
    favoritesSet,
    flatModels,
    instanceEntries,
    instanceOrder,
    isLocked,
    matchesLockedProvider,
    searchQuery,
    selectedDriverKind,
  ]);

  const legacySection = useMemo(() => {
    if (isSearching || selectedDriverKind === "favorites") {
      return null;
    }
    const currentModels = filteredModels.filter((model) => !model.isLegacy);
    const legacyModels = filteredModels.filter((model) => model.isLegacy);
    if (legacyModels.length === 0) {
      return null;
    }
    return {
      key: modelPickerLegacySectionKey(legacyModels[0]?.instanceId ?? props.activeInstanceId),
      currentModels,
      legacyModels,
      isExpanded: expandedLegacyDrivers.has(selectedDriverKind),
    };
  }, [
    expandedLegacyDrivers,
    filteredModels,
    isSearching,
    props.activeInstanceId,
    selectedDriverKind,
  ]);

  const visibleModels = useMemo(() => {
    if (!legacySection) {
      return filteredModels;
    }
    return [
      ...legacySection.currentModels,
      ...(legacySection.isExpanded ? legacySection.legacyModels : []),
    ];
  }, [filteredModels, legacySection]);

  const selectedRailEntry =
    selectedDriverKind === "favorites"
      ? undefined
      : sidebarInstanceEntries.find((entry) => entry.driverKind === selectedDriverKind);
  const providerSetupEntries =
    !isSearching && props.onOpenProviderSetup
      ? instanceEntries.filter(
          (entry) =>
            matchesLockedProvider(entry) &&
            shouldOfferModelPickerSetup(
              entry,
              modelOptionsByInstance.get(entry.instanceId) ?? [],
            ) &&
            (selectedRailEntry
              ? entry.driverKind === selectedRailEntry.driverKind
              : filteredModels.length === 0),
        )
      : [];

  // Models the manifest announces that this provider's installed CLI is too
  // old to run. Without this, a new model just seems missing until the user
  // happens to update the CLI.
  // A search spans every instance, so it can explain gated matches from any of them.
  const updateRequiredNotices = (
    isSearching
      ? instanceEntries.filter(matchesLockedProvider)
      : selectedRailEntry
        ? [selectedRailEntry]
        : []
  ).flatMap((entry) => {
    const notice = formatProviderUpdateRequiredNotice(entry.snapshot, searchQuery);
    return notice ? [{ instanceId: entry.instanceId, notice }] : [];
  });

  const toggleLegacySection = useCallback(
    (instanceId: ProviderInstanceId) => {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) return;
      setExpandedLegacyDrivers((expanded) => {
        const next = new Set(expanded);
        if (next.has(entry.driverKind)) {
          next.delete(entry.driverKind);
        } else {
          next.add(entry.driverKind);
        }
        return next;
      });
    },
    [entryByInstanceId],
  );

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId, additive = false, fork = false) => {
      if (getModelDisabledReason?.(instanceId, modelSlug)) {
        return;
      }
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        return;
      }
      const resolvedInstanceId =
        resolveInstanceForModelSelection({
          entries: instanceEntries,
          modelOptionsByInstance,
          driverKind: entry.driverKind,
          slug: modelSlug,
          preferredInstanceId: props.activeInstanceId,
          ...(props.lockedContinuationGroupKey != null
            ? { lockedContinuationGroupKey: props.lockedContinuationGroupKey }
            : {}),
        }) ?? instanceId;
      if (getModelDisabledReason?.(resolvedInstanceId, modelSlug)) {
        return;
      }
      const options = modelOptionsByInstance.get(resolvedInstanceId);
      if (!options) {
        return;
      }
      const resolvedEntry = entryByInstanceId.get(resolvedInstanceId) ?? entry;
      // `resolveSelectableModel` uses the driver kind for normalization
      // (slug casing etc.). Custom instances share their driver's
      // normalization rules, so pass the driver kind here.
      const resolvedModel = resolveSelectableModel(resolvedEntry.driverKind, modelSlug, options);
      if (resolvedModel) {
        if (onForkModel && fork) {
          onForkModel(resolvedInstanceId, resolvedModel);
        } else if (
          requiresFork({
            driverKind: resolvedEntry.driverKind,
            continuationGroupKey: resolvedEntry.continuationGroupKey,
            instanceId: resolvedInstanceId,
            slug: resolvedModel,
          })
        ) {
          // Only the row's fork button opens these, so a stray click never forks.
          return;
        } else if (additive && onToggleModel) {
          onToggleModel(resolvedInstanceId, resolvedModel);
        } else {
          onInstanceModelChange(resolvedInstanceId, resolvedModel);
        }
      }
    },
    [
      entryByInstanceId,
      getModelDisabledReason,
      instanceEntries,
      modelOptionsByInstance,
      onForkModel,
      onInstanceModelChange,
      onToggleModel,
      props.activeInstanceId,
      props.lockedContinuationGroupKey,
      requiresFork,
    ],
  );

  const toggleFavorite = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const newFavorites = [...favorites];
      const index = newFavorites.findIndex((f) => f.provider === instanceId && f.model === model);
      if (index >= 0) {
        newFavorites.splice(index, 1);
      } else {
        newFavorites.push({ provider: instanceId, model });
      }
      updateSettings({ favorites: newFavorites });
    },
    [favorites, updateSettings],
  );

  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<
      string,
      NonNullable<ReturnType<typeof modelPickerJumpCommandForIndex>>
    >();
    let selectableModelIndex = 0;
    for (const model of visibleModels) {
      if (getModelDisabledReason?.(model.instanceId, model.slug)) {
        continue;
      }
      const jumpCommand = modelPickerJumpCommandForIndex(selectableModelIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(modelPickerModelKey(model.instanceId, model.slug), jumpCommand);
      selectableModelIndex += 1;
    }
    return mapping;
  }, [getModelDisabledReason, visibleModels]);
  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  const allItemKeys = useMemo(
    (): string[] => [
      ...flatModels.map((model) => modelPickerModelKey(model.instanceId, model.slug)),
      ...new Set(
        flatModels
          .filter((model) => model.isLegacy)
          .map((model) => modelPickerLegacySectionKey(model.instanceId)),
      ),
    ],
    [flatModels],
  );
  const filteredItemKeys = useMemo((): string[] => {
    const modelKeys = visibleModels.map((model) =>
      modelPickerModelKey(model.instanceId, model.slug),
    );
    if (!legacySection) {
      return modelKeys;
    }
    modelKeys.splice(legacySection.currentModels.length, 0, legacySection.key);
    return modelKeys;
  }, [legacySection, visibleModels]);
  const filteredModelByKey = useMemo(
    (): ReadonlyMap<string, ModelPickerItem> =>
      new Map(
        visibleModels.map(
          (model) => [modelPickerModelKey(model.instanceId, model.slug), model] as const,
        ),
      ),
    [visibleModels],
  );
  const comboboxValue = useMemo(() => {
    if (onToggleModel) {
      return visibleModels
        .filter((model) => isCollapsedModelSelected(model))
        .map((model) => modelPickerModelKey(model.instanceId, model.slug));
    }
    const selected = visibleModels.find((model) => isCollapsedModelSelected(model));
    return selected ? modelPickerModelKey(selected.instanceId, selected.slug) : activeModelKey;
  }, [activeModelKey, isCollapsedModelSelected, onToggleModel, visibleModels]);
  const [modelListContentSize, setModelListContentSize] = useState(
    () => filteredItemKeys.length * MODEL_LIST_ESTIMATED_ITEM_SIZE,
  );
  const [searchHeight, setSearchHeight] = useState(0);
  useLayoutEffect(
    () => modelListRef.current?.getState().listen("totalSize", setModelListContentSize),
    [],
  );
  // Fit the list to its rows plus the combobox list `py-1` and LegendList `py-1.5`.
  const modelListHeight =
    filteredItemKeys.length === 0 ? 0 : `calc(${modelListContentSize}px + var(--spacing) * 5)`;
  const updateModelListScrollFades = useCallback(() => {
    const scrollElement = modelListRef.current?.getScrollableNode();
    if (!(scrollElement instanceof HTMLElement)) {
      return;
    }
    const maxScrollOffset = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    setShowTopScrollFade(scrollElement.scrollTop > 1);
    setShowBottomScrollFade(maxScrollOffset - scrollElement.scrollTop > 1);
  }, []);
  const modelJumpShortcutContext = useMemo(
    () =>
      ({
        terminalFocus: false,
        terminalOpen: props.terminalOpen,
        modelPickerOpen: true,
      }) as const,
    [props.terminalOpen],
  );
  const modelJumpLabelByKey = useMemo((): ReadonlyMap<string, string> => {
    if (modelJumpCommandByKey.size === 0) {
      return EMPTY_MODEL_JUMP_LABELS;
    }
    const shortcutLabelOptions = {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    };
    const mapping = new Map<string, string>();
    for (const [modelKey, command] of modelJumpCommandByKey) {
      const label = shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
      if (label) {
        mapping.set(modelKey, label);
      }
    }
    return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
  }, [keybindings, modelJumpCommandByKey, modelJumpShortcutContext]);
  const modelListExtraData = useMemo(
    () => ({
      favoritesSet,
      modelJumpLabelByKey,
      isCollapsedModelSelected,
      isSearching,
      selectedDriverKind,
    }),
    [favoritesSet, modelJumpLabelByKey, isCollapsedModelSelected, isSearching, selectedDriverKind],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen()) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: modelJumpShortcutContext,
      });
      if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
        event.preventDefault();
        event.stopPropagation();
        const next = adjacentModelPickerProvider({
          entries: sidebarInstanceEntries,
          selectedDriverKind,
          direction: command === "modelPicker.nextProvider" ? 1 : -1,
          disabledDriverKinds: lockedDisabledDriverKinds,
          selectableUnavailableDriverKinds,
        });
        setSearchQuery("");
        handleSelectDriver(next);
        return;
      }
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const targetModelKey = modelJumpModelKeys[jumpIndex];
      if (!targetModelKey) {
        return;
      }
      const model = parseModelPickerModelKey(targetModelKey);
      if (!model) {
        return;
      }
      handleModelSelect(model.slug, model.instanceId);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [
    handleModelSelect,
    handleSelectDriver,
    keybindings,
    lockedDisabledDriverKinds,
    modelJumpModelKeys,
    modelJumpShortcutContext,
    selectableUnavailableDriverKinds,
    selectedDriverKind,
    sidebarInstanceEntries,
  ]);

  useLayoutEffect(() => {
    setShowTopScrollFade(false);
    setShowBottomScrollFade(filteredItemKeys.length > 5);
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      updateModelListScrollFades();
      nestedFrame = window.requestAnimationFrame(updateModelListScrollFades);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
    };
  }, [filteredItemKeys, updateModelListScrollFades]);

  return (
    <TooltipProvider delay={0}>
      <div
        ref={pickerContentRef}
        className="relative flex max-h-86.5 w-screen max-w-90 flex-row overflow-hidden"
        // Hold the height from when the search started; results scroll instead of resizing.
        style={isSearching ? { height: searchHeight } : undefined}
        data-model-picker-content="true"
      >
        {/* Sidebar */}
        {showSidebar && (
          <ModelPickerSidebar
            selectedDriverKind={selectedDriverKind}
            onSelectDriver={handleSelectDriver}
            onFocusSearch={focusSearchInput}
            instanceEntries={sidebarInstanceEntries}
            showFavorites
            {...(selectableUnavailableDriverKinds ? { selectableUnavailableDriverKinds } : {})}
            {...(lockedDisabledDriverKinds
              ? {
                  disabledDriverKinds: lockedDisabledDriverKinds,
                  getDisabledProviderTooltip: (entry: ProviderInstanceEntry) =>
                    `${providerBrandLabel(entry.driverKind)} is unavailable in this thread. Start a new thread to switch providers.`,
                }
              : {})}
          />
        )}

        {/* Main content area */}
        <Combobox<string, boolean>
          inline
          items={allItemKeys}
          filteredItems={filteredItemKeys}
          filter={null}
          autoHighlight
          open
          virtualized
          multiple={onToggleModel !== undefined}
          value={comboboxValue}
          onItemHighlighted={(modelKey, eventDetails) => {
            highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
            if (eventDetails.reason === "keyboard" && eventDetails.index >= 0) {
              void modelListRef.current?.scrollIndexIntoView?.({
                index: eventDetails.index,
                animated: false,
              });
            }
          }}
          onValueChange={(value, details) => {
            const previousKeys = Array.isArray(comboboxValue)
              ? comboboxValue
              : comboboxValue
                ? [comboboxValue]
                : [];
            const modelKey = Array.isArray(value)
              ? (value.find((key) => !previousKeys.includes(key)) ??
                previousKeys.find((key) => !value.includes(key)))
              : value;
            if (typeof modelKey !== "string") {
              return;
            }
            const legacyInstanceId = parseModelPickerLegacySectionKey(modelKey);
            if (legacyInstanceId) {
              toggleLegacySection(legacyInstanceId);
              return;
            }
            const model = parseModelPickerModelKey(modelKey);
            if (model) {
              handleModelSelect(
                model.slug,
                model.instanceId,
                "shiftKey" in details.event && details.event.shiftKey === true,
              );
            }
          }}
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/40",
              showSidebar && "border-l border-border/70",
            )}
          >
            <ComboboxSearchInput
              ref={searchInputRef}
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => {
                if (!isSearching) setSearchHeight(pickerContentRef.current?.offsetHeight ?? 0);
                setSearchQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (
                  showSidebar &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  ((e.key === "ArrowLeft" && !e.shiftKey && searchQuery.length === 0) ||
                    (e.key === "Tab" && e.shiftKey))
                ) {
                  const sidebar = e.currentTarget
                    .closest("[data-model-picker-content]")
                    ?.querySelector("[data-model-picker-sidebar]");
                  const button =
                    sidebar?.querySelector<HTMLButtonElement>(
                      'button[aria-pressed="true"]:not(:disabled)',
                    ) ?? sidebar?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                  if (button) {
                    e.preventDefault();
                    e.stopPropagation();
                    button.focus();
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onRequestClose?.();
                  return;
                }
                if (e.key === "Enter" && highlightedModelKeyRef.current) {
                  (e as typeof e & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
                  e.preventDefault();
                  e.stopPropagation();
                  const legacyInstanceId = parseModelPickerLegacySectionKey(
                    highlightedModelKeyRef.current,
                  );
                  if (legacyInstanceId) {
                    toggleLegacySection(legacyInstanceId);
                    return;
                  }
                  const model = parseModelPickerModelKey(highlightedModelKeyRef.current);
                  if (model) {
                    handleModelSelect(model.slug, model.instanceId, e.shiftKey);
                  }
                  return;
                }
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            />

            {/* Model list */}
            <div
              className="relative min-h-0 overflow-hidden pr-px"
              style={{ height: modelListHeight }}
            >
              <ComboboxListVirtualized>
                <LegendList<string>
                  ref={modelListRef}
                  data={filteredItemKeys}
                  extraData={modelListExtraData}
                  keyExtractor={(modelKey) => modelKey}
                  renderItem={({ item: modelKey, index }) => {
                    if (legacySection?.key === modelKey) {
                      return (
                        <ComboboxItem
                          hideIndicator
                          index={index}
                          value={modelKey}
                          aria-expanded={legacySection.isExpanded}
                          className="group w-full cursor-pointer"
                        >
                          <div className="min-w-0 flex-1 text-left">
                            <div className="text-xs font-medium leading-snug">Legacy models</div>
                            <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground/70">
                              {legacySection.legacyModels.length} models
                            </div>
                          </div>
                          <ChevronRightIcon
                            className={cn(
                              "size-4 transition-transform",
                              legacySection.isExpanded && "rotate-90",
                            )}
                          />
                        </ComboboxItem>
                      );
                    }
                    const model = filteredModelByKey.get(modelKey);
                    if (!model) {
                      return null;
                    }
                    const disabledReason =
                      getModelDisabledReason?.(model.instanceId, model.slug) ?? null;
                    const isFavorite = isDriverModelFavorite({
                      favoritesSet,
                      driverKind: model.driverKind,
                      slug: model.slug,
                      entries: instanceEntries,
                    });
                    const isSelected = isCollapsedModelSelected(model);
                    const showProvider =
                      isSearching ||
                      selectedDriverKind === "favorites" ||
                      Boolean(model.subProvider);
                    return (
                      <ModelListRow
                        key={modelKey}
                        index={index}
                        model={model}
                        instanceId={model.instanceId}
                        driverKind={model.driverKind}
                        providerDisplayName={model.instanceDisplayName}
                        providerAccentColor={model.instanceAccentColor}
                        acpRegistryAgentId={model.acpRegistryAgentId}
                        acpRegistryIconUrl={model.acpRegistryIconUrl}
                        isFavorite={isFavorite}
                        isSelected={isSelected}
                        showSelection={selectedModelKeys !== undefined}
                        showProvider={showProvider}
                        preferShortName={!isLocked}
                        useTriggerLabel={false}
                        showNewBadge={model.badge === "new"}
                        unavailable={model.isUnavailable === true}
                        jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                        disabledReason={disabledReason}
                        onToggleFavorite={() => toggleFavorite(model.instanceId, model.slug)}
                        {...(onForkModel
                          ? {
                              forkOnly: requiresFork(model),
                              onFork: () =>
                                handleModelSelect(model.slug, model.instanceId, false, true),
                            }
                          : {})}
                      />
                    );
                  }}
                  estimatedItemSize={MODEL_LIST_ESTIMATED_ITEM_SIZE}
                  drawDistance={480}
                  recycleItems
                  contentContainerClassName="pl-2 pr-px"
                  ItemSeparatorComponent={ModelListSeparator}
                  onLayout={updateModelListScrollFades}
                  onScroll={updateModelListScrollFades}
                  className={cn(
                    "scrollbar-gutter-stable h-full overflow-x-hidden overscroll-y-contain py-1.5 [&::-webkit-scrollbar-track]:my-2",
                    getVirtualizedScrollFadeClassName({
                      top: showTopScrollFade,
                      bottom: showBottomScrollFade,
                    }),
                  )}
                />
              </ComboboxListVirtualized>
            </div>
            {providerSetupEntries.length > 0 ? (
              <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border/70 p-2">
                {providerSetupEntries.map((entry) => (
                  <div key={entry.instanceId} className="px-1 py-1.5 text-xs leading-snug">
                    <p className="line-clamp-3 text-muted-foreground">
                      {getProviderStatusMessage(entry.snapshot)}
                    </p>
                    <InlineButton
                      className="mt-1"
                      onClick={() => {
                        props.onRequestClose?.();
                        props.onOpenProviderSetup?.(entry.instanceId);
                      }}
                    >
                      {providerSetupEntries.length > 1
                        ? `Set up ${entry.displayName}`
                        : "Open provider setup"}
                    </InlineButton>
                  </div>
                ))}
              </div>
            ) : (
              <ComboboxEmpty className="empty:h-0">No models found</ComboboxEmpty>
            )}
            {updateRequiredNotices.map(({ instanceId, notice }) => (
              <p
                key={instanceId}
                className="shrink-0 border-t border-border/70 px-3 py-2 text-xs leading-snug text-muted-foreground"
              >
                {notice}{" "}
                <InlineButton
                  onClick={() => {
                    props.onRequestClose?.();
                    void navigate({ to: "/settings/providers" });
                  }}
                >
                  Provider settings
                </InlineButton>
              </p>
            ))}
          </div>
        </Combobox>
      </div>
    </TooltipProvider>
  );
});
