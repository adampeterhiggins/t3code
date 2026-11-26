import { T, useGT, useLocale, useMessages } from "gt-react";
import { useLegendListRef } from "~/hooks/useLegendListRef";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type EnvironmentId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { useAtomValue } from "@effect/atom-react";
import {
  formatProviderUpdateRequiredNotice,
  providerUpdateChannelLags,
} from "@t3tools/client-runtime/providerUpdateRequiredModels";
import { groupModelsBySubProvider } from "@t3tools/client-runtime/providerSubProviders";
import { useNavigate } from "@tanstack/react-router";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  memo,
  useState,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRightIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { useProviderWorkspaceSnapshotRefresh } from "./useProviderWorkspaceSnapshotRefresh";
import { getProviderStatusMessage, hasProviderSetup } from "./ProviderStatusBanner";
import {
  modelPickerLegacySectionKey,
  modelPickerModelKey,
  modelPickerSubProviderSectionKey,
  parseModelPickerLegacySectionKey,
  parseModelPickerModelKey,
} from "./modelPickerKeys";
import { rankModelPickerSearch } from "@t3tools/client-runtime/model-search";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxListVirtualized,
} from "../ui/combobox";
import { ModelEsque } from "./providerIconUtils";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { registerModelPickerContent } from "../../modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import {
  useEnvironmentModelPreferences,
  useToggleEnvironmentModelFavorite,
} from "~/hooks/useSettings";
import { announce } from "~/lib/announce";
import { cn } from "~/lib/utils";
import { getVirtualizedScrollFadeClassName } from "../ui/scroll-area";
import { InlineButton } from "../ui/button";
import { Badge } from "../ui/badge";
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
import { hasRuntimeModelCatalog } from "../../providerModels";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  badge?: "new";
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
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
    hasRuntimeModelCatalog(input.entry.driverKind) &&
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
const MODEL_LIST_ESTIMATED_ITEM_SIZE = 32;
// Rendered heights in `--spacing` units. Chrome is the search box and list padding, plus a 1px border.
const ROW_UNITS = 8;
const ROW_SEPARATOR_UNITS = 0.5;
const LIST_CHROME_UNITS = 15.5;

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

function ModelPickerProviderNotices({
  setupEntries,
  updateRequiredNotices,
  emptyLabel,
  onRequestClose,
  onOpenProviderSetup,
}: {
  setupEntries: ReadonlyArray<ProviderInstanceEntry>;
  emptyLabel: string;
  updateRequiredNotices: ReadonlyArray<{
    instanceId: ProviderInstanceId;
    notice: string;
    canUpdateInSettings: boolean;
  }>;
  onRequestClose: (() => void) | undefined;
  onOpenProviderSetup: ((instanceId: ProviderInstanceId) => void) | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  return (
    <>
      {setupEntries.length > 0 ? (
        <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border/70 p-2">
          {setupEntries.map((entry) => (
            <div key={entry.instanceId} className="px-1 py-1.5 text-xs leading-snug">
              <p className="line-clamp-3 text-muted-foreground">
                {getProviderStatusMessage(entry.snapshot, messages)}
              </p>
              <InlineButton
                className="mt-1"
                onClick={() => {
                  onRequestClose?.();
                  onOpenProviderSetup?.(entry.instanceId);
                }}
              >
                {setupEntries.length > 1
                  ? gt("Set up {provider}", { provider: entry.displayName })
                  : gt("Open provider setup")}
              </InlineButton>
            </div>
          ))}
        </div>
      ) : (
        <ComboboxEmpty className="empty:h-0">{emptyLabel}</ComboboxEmpty>
      )}
      {updateRequiredNotices.map(({ instanceId, notice, canUpdateInSettings }) => (
        <p
          key={instanceId}
          className="shrink-0 border-t border-border/70 px-3 py-2 text-xs leading-snug text-muted-foreground"
        >
          {notice}
          {canUpdateInSettings ? (
            <>
              {" "}
              <InlineButton
                onClick={() => {
                  onRequestClose?.();
                  void navigate({ to: "/settings/providers" });
                }}
              >
                <T>Provider settings</T>
              </InlineButton>
            </>
          ) : null}
        </p>
      ))}
    </>
  );
}

function ModelPickerList({
  listRef,
  itemKeys,
  extraData,
  renderItem,
}: {
  listRef: RefObject<LegendListRef | null>;
  itemKeys: ReadonlyArray<string>;
  extraData: unknown;
  renderItem: (props: { item: string; index: number }) => ReactNode;
}) {
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const updateScrollFades = () => {
    const metrics = listRef.current?.getState();
    if (!metrics) return;
    setShowTopScrollFade(!metrics.isAtStart);
    setShowBottomScrollFade(!metrics.isAtEnd);
  };
  const scrollRef = useLegendListRef(listRef, updateScrollFades);

  return (
    <div
      className={cn(
        "relative min-h-0 overflow-hidden pr-px",
        itemKeys.length > 0 ? "flex-1" : "h-0",
      )}
    >
      <ComboboxListVirtualized>
        <LegendList<string>
          ref={scrollRef}
          data={itemKeys}
          extraData={extraData}
          keyExtractor={(modelKey) => modelKey}
          renderItem={renderItem}
          estimatedItemSize={MODEL_LIST_ESTIMATED_ITEM_SIZE}
          drawDistance={480}
          recycleItems
          contentContainerClassName="pl-2 pr-px"
          ItemSeparatorComponent={ModelListSeparator}
          onLayout={updateScrollFades}
          onScroll={updateScrollFades}
          onReady={updateScrollFades}
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
  );
}

// Capture gives picker shortcuts priority over the composer.
function WindowKeyDownListener({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }) {
  const handleKeyDown = useEffectEvent(onKeyDown);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a capture-phase window keydown listener for the picker's lifetime
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, []);
  return null;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  environmentId: EnvironmentId | null;
  /** Keeps the open provider tab's catalog fresh for this directory. */
  workspaceCwd?: string | null;
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
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
  /** The owning popup moves focus here when it opens (its `initialFocus`). */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** Sits beside an effort column: fills the shared row, and stacks above it on narrow screens. */
  docked?: boolean;
  /** Right at the end of the search text moves into the popup's effort column. */
  onFocusEffort?: () => void;
  /** Closes the list column, inside the popup's fixed height. */
  listFooter?: ReactNode;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const {
    searchInputRef,
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
  const modelListRef = useRef<LegendListRef | null>(null);
  const pickerContentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes this picker's mount to global keydown handlers
  useLayoutEffect(() => registerModelPickerContent(), []);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const { favorites } = useEnvironmentModelPreferences(props.environmentId);
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
  const isCollapsedModelSelected = (
    model: Pick<ModelPickerItem, "driverKind" | "slug" | "instanceId">,
  ) => {
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
  };
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
      const hasPickableFavorite = favorites.some((favorite) => {
        const entry = instanceEntries.find((entry) => entry.instanceId === favorite.provider);
        return (
          entry !== undefined &&
          (modelOptionsByInstance.get(favorite.provider) ?? []).some(
            (option) =>
              option.slug === favorite.model &&
              shouldIncludeModelPickerOption({
                entry,
                option,
                activeInstanceId: props.activeInstanceId,
                activeModel: activeModelSlug,
              }),
          )
        );
      });
      return hasPickableFavorite ? "favorites" : (activeEntry?.driverKind ?? "favorites");
    },
  );
  const { scanning: workspaceModelsScanning } = useProviderWorkspaceSnapshotRefresh({
    environmentId: props.environmentId,
    gitCwd: props.workspaceCwd ?? null,
    instanceId: props.activeInstanceId,
  });
  const favoritesSet = new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  const [expandedLegacyDrivers, setExpandedLegacyDrivers] = useState(
    () =>
      new Set<ProviderDriverKind>(
        modelOptionsByInstance
          .get(props.activeInstanceId)
          ?.some((model) => model.slug === activeModelSlug && model.isLegacy) &&
          activeEntry &&
          !favoritesSet.has(providerModelKey(props.activeInstanceId, activeModelSlug))
          ? [activeEntry.driverKind]
          : [],
      ),
  );
  // The thread's backend opens expanded, so its models show without a click.
  const [expandedSubProviderKeys, setExpandedSubProviderKeys] = useState(
    () =>
      new Set<string>(
        activeModel?.subProvider
          ? [modelPickerSubProviderSectionKey(props.activeInstanceId, activeModel.subProvider)]
          : [],
      ),
  );
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = providedKeybindings ?? serverKeybindings;
  const [searchHeight, setSearchHeight] = useState(0);
  const toggleFavorite = useToggleEnvironmentModelFavorite(props.environmentId);

  const focusSearchInput = () => {
    searchInputRef.current?.focus({ preventScroll: true });
  };

  const handleSelectDriver = (driverKind: ProviderDriverKind | "favorites") => {
    setSelectedDriverKind(driverKind);
    if (window.matchMedia("(pointer: coarse)").matches) return;
    window.requestAnimationFrame(() => {
      focusSearchInput();
    });
  };

  const toggleSubProviderSection = (key: string) => {
    setExpandedSubProviderKeys((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const entryByInstanceId = new Map(instanceEntries.map((entry) => [entry.instanceId, entry]));
  const matchesLockedProvider = (
    entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">,
  ): boolean =>
    matchesModelPickerLock({
      entry,
      lockedProvider: props.lockedProvider,
      lockedContinuationGroupKey: props.lockedContinuationGroupKey ?? null,
    });

  const selectableUnavailableDriverKinds = (() => {
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
  })();

  // another lookup. Account duplicates are collapsed later.
  const flatModels = (() => {
    const out: ModelPickerItem[] = [];
    const seenKeys = new Set<string>();
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        continue;
      }
      for (const model of models) {
        const key = modelPickerModelKey(instanceId, model.slug);
        if (
          seenKeys.has(key) ||
          !shouldIncludeModelPickerOption({
            entry,
            option: model,
            activeInstanceId: props.activeInstanceId,
            activeModel: activeModelSlug,
          })
        ) {
          continue;
        }
        seenKeys.add(key);
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
  })();

  const subProvidersByInstance = new Map(
    instanceEntries.flatMap((entry) =>
      entry.snapshot.subProviders?.length
        ? [[entry.instanceId, entry.snapshot.subProviders] as const]
        : [],
    ),
  );
  // With forking available, other providers stay listed and open in a new tab instead.
  const isLocked = props.lockedProvider !== null && onForkModel === undefined;
  const requiresFork = (
    model: Pick<ModelPickerItem, "driverKind" | "continuationGroupKey" | "instanceId" | "slug">,
  ) =>
    onForkModel !== undefined &&
    (!matchesLockedProvider(model) || modelRequiresFork?.(model.instanceId, model.slug) === true);
  const isSearching = searchQuery.trim().length > 0;
  // Fit the tallest tab so switching tabs never resizes the popup and moves the rail under the cursor.
  const tallestTabUnits = (() => {
    const unitsByTab = new Map<ProviderInstanceId | "favorites", number>();
    const addRow = (tab: ProviderInstanceId | "favorites") => {
      const previous = unitsByTab.get(tab);
      unitsByTab.set(
        tab,
        previous === undefined ? ROW_UNITS : previous + ROW_SEPARATOR_UNITS + ROW_UNITS,
      );
    };
    const tabsWithLegacyRow = new Set<ProviderInstanceId>();
    for (const model of flatModels) {
      if (!matchesLockedProvider(model)) continue;
      const isFavorite = favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      if (isFavorite) addRow("favorites");
      if (model.isLegacy && !isFavorite) {
        tabsWithLegacyRow.add(model.instanceId);
      } else {
        addRow(model.instanceId);
      }
    }
    for (const instanceId of tabsWithLegacyRow) addRow(instanceId);
    for (const [instanceId, subProviders] of subProvidersByInstance) {
      for (const _subProvider of subProviders) addRow(instanceId);
    }
    return Math.max(0, ...unitsByTab.values());
  })();
  const lockedDisabledDriverKinds = (() => {
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
  })();
  const sidebarInstanceEntries = (() => {
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
  })();
  const showSidebar = !isSearching && sidebarInstanceEntries.length > 0;
  const instanceOrder = (() => instanceEntries.map((entry) => entry.instanceId))();

  // Filter models based on search query and selected provider
  const filteredModels = (() => {
    let result = flatModels;

    if (searchQuery.trim()) {
      const candidates = isLocked ? result.filter((m) => matchesLockedProvider(m)) : result;
      return rankModelPickerSearch(candidates, searchQuery, (model) => ({
        name: model.name,
        slug: model.slug,
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
      }));
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
  })();

  const legacySection = (() => {
    if (isSearching || selectedDriverKind === "favorites") {
      return null;
    }
    const currentModels: ModelPickerItem[] = [];
    const legacyModels: ModelPickerItem[] = [];
    for (const model of filteredModels) {
      const isLegacy =
        model.isLegacy && !favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      (isLegacy ? legacyModels : currentModels).push(model);
    }
    if (legacyModels.length === 0) {
      return null;
    }
    return {
      key: modelPickerLegacySectionKey(legacyModels[0]?.instanceId ?? props.activeInstanceId),
      currentModels,
      legacyModels,
      isExpanded: expandedLegacyDrivers.has(selectedDriverKind),
    };
  })();

  // A provider whose models run on several backends, such as fx, lists each
  // backend as a collapsible heading. Search and Favorites stay flat.
  const subProviderSections = (() => {
    // The rail selects a driver; sub-providers belong to that driver's rail instance.
    const selectedInstanceId =
      isSearching || selectedDriverKind === "favorites"
        ? undefined
        : sidebarInstanceEntries.find((entry) => entry.driverKind === selectedDriverKind)
            ?.instanceId;
    const subProviders =
      selectedInstanceId === undefined ? undefined : subProvidersByInstance.get(selectedInstanceId);
    if (!subProviders || selectedInstanceId === undefined) return null;
    const { ungrouped, groups } = groupModelsBySubProvider(
      filteredModels,
      subProviders,
      (model) => model.subProvider,
    );
    return {
      ungrouped,
      sections: groups.map(({ subProvider, models }) => {
        const key = modelPickerSubProviderSectionKey(selectedInstanceId, subProvider.name);
        return {
          key,
          name: subProvider.name,
          unavailableReason: subProvider.unavailableReason,
          models,
          isExpanded: expandedSubProviderKeys.has(key),
        };
      }),
    };
  })();
  const subProviderSectionByKey = new Map(
    subProviderSections?.sections.map((section) => [section.key, section] as const),
  );

  const visibleModels = (() => {
    if (subProviderSections) {
      return [
        ...subProviderSections.ungrouped,
        ...subProviderSections.sections.flatMap((section) =>
          section.isExpanded ? section.models : [],
        ),
      ];
    }
    if (!legacySection) {
      return filteredModels;
    }
    return [
      ...legacySection.currentModels,
      ...(legacySection.isExpanded ? legacySection.legacyModels : []),
    ];
  })();

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

  const updateRequiredNotices = (
    isSearching
      ? instanceEntries.filter(matchesLockedProvider)
      : selectedRailEntry
        ? [selectedRailEntry]
        : []
  ).flatMap((entry) => {
    const notice = formatProviderUpdateRequiredNotice(
      entry.snapshot,
      searchQuery,
      messages,
      locale,
    );
    return notice
      ? [
          {
            instanceId: entry.instanceId,
            notice,
            canUpdateInSettings: !providerUpdateChannelLags(entry.snapshot, searchQuery),
          },
        ]
      : [];
  });

  const toggleLegacySection = (instanceId: ProviderInstanceId) => {
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
  };

  const handleModelSelect = (
    modelSlug: string,
    instanceId: ProviderInstanceId,
    additive = false,
    fork = false,
  ) => {
    if (getModelDisabledReason?.(instanceId, modelSlug)) {
      return null;
    }
    const entry = entryByInstanceId.get(instanceId);
    if (!entry) {
      return null;
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
      return null;
    }
    const options = modelOptionsByInstance.get(resolvedInstanceId);
    if (!options) {
      return null;
    }
    const resolvedEntry = entryByInstanceId.get(resolvedInstanceId) ?? entry;
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
        return null;
      } else if (additive && onToggleModel) {
        onToggleModel(resolvedInstanceId, resolvedModel);
      } else {
        onInstanceModelChange(resolvedInstanceId, resolvedModel);
      }
      return resolvedModel;
    }
    return null;
  };

  const modelJumpCommandByKey = (() => {
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
  })();
  const modelJumpModelKeys = (() => [...modelJumpCommandByKey.keys()])();
  const allItemKeys = ((): string[] => [
    ...flatModels.map((model) => modelPickerModelKey(model.instanceId, model.slug)),
    ...new Set(
      flatModels
        .filter((model) => model.isLegacy)
        .map((model) => modelPickerLegacySectionKey(model.instanceId)),
    ),
    ...[...subProvidersByInstance].flatMap(([instanceId, subProviders]) =>
      subProviders.map((subProvider) =>
        modelPickerSubProviderSectionKey(instanceId, subProvider.name),
      ),
    ),
  ])();
  const filteredItemKeys = ((): string[] => {
    const keyOf = (model: ModelPickerItem) => modelPickerModelKey(model.instanceId, model.slug);
    if (subProviderSections) {
      return [
        ...subProviderSections.ungrouped.map(keyOf),
        ...subProviderSections.sections.flatMap((section) => [
          section.key,
          ...(section.isExpanded ? section.models.map(keyOf) : []),
        ]),
      ];
    }
    const modelKeys = visibleModels.map(keyOf);
    // The toggle trails the list, so expanding it reveals older models above it.
    return legacySection ? [...modelKeys, legacySection.key] : modelKeys;
  })();
  const filteredModelByKey = ((): ReadonlyMap<string, ModelPickerItem> =>
    new Map(
      visibleModels.map(
        (model) => [modelPickerModelKey(model.instanceId, model.slug), model] as const,
      ),
    ))();
  const comboboxValue = (() => {
    if (onToggleModel) {
      return visibleModels
        .filter((model) => isCollapsedModelSelected(model))
        .map((model) => modelPickerModelKey(model.instanceId, model.slug));
    }
    const selected = visibleModels.find((model) => isCollapsedModelSelected(model));
    return selected ? modelPickerModelKey(selected.instanceId, selected.slug) : activeModelKey;
  })();
  const modelJumpShortcutContext = (() =>
    ({
      terminalFocus: false,
      terminalOpen: props.terminalOpen,
      modelPickerOpen: true,
    }) as const)();
  const modelJumpLabelByKey = ((): ReadonlyMap<string, string> => {
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
  })();
  const modelListExtraData = (() => ({
    favoritesSet,
    modelJumpLabelByKey,
    isCollapsedModelSelected,
    isSearching,
    selectedDriverKind,
  }))();

  const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    ) {
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
      announce(next === "favorites" ? gt("Favorites") : providerBrandLabel(next), "model-picker");
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
    const selectedSlug = handleModelSelect(model.slug, model.instanceId);
    if (selectedSlug === null) return;
    const name = flatModels.find(
      (item) =>
        item.slug === selectedSlug &&
        item.driverKind === entryByInstanceId.get(model.instanceId)?.driverKind,
    )?.name;
    announce(gt("Model: {name}", { name: name ?? selectedSlug }), "model-picker");
  };

  return (
    <>
      <WindowKeyDownListener onKeyDown={onWindowKeyDown} />
      <div
        ref={pickerContentRef}
        className={cn(
          "relative flex w-screen max-w-90 flex-row overflow-hidden",
          props.docked ? "max-sm:h-56 max-sm:w-full max-sm:max-w-none" : "max-h-86.5",
        )}
        // Docked, the popup sets the height; a minimum here would overflow short windows.
        style={
          props.docked
            ? undefined
            : isSearching
              ? { height: searchHeight }
              : {
                  minHeight: `min(calc(var(--spacing) * ${tallestTabUnits + LIST_CHROME_UNITS} + 1px), calc(var(--spacing) * 86.5))`,
                }
        }
        data-model-picker-content="true"
      >
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
                    gt(
                      "{provider} is unavailable in this thread. Start a new thread to switch providers.",
                      { provider: providerBrandLabel(entry.driverKind) },
                    ),
                }
              : {})}
          />
        )}

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
            if (subProviderSectionByKey.has(modelKey)) {
              toggleSubProviderSection(modelKey);
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
              placeholder={gt("Search models...")}
              value={searchQuery}
              onChange={(e) => {
                if (!isSearching) setSearchHeight(pickerContentRef.current?.offsetHeight ?? 0);
                setSearchQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  (e as typeof e & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
                  e.stopPropagation();
                  return;
                }
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
                if (
                  props.onFocusEffort &&
                  e.key === "ArrowRight" &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.shiftKey &&
                  e.currentTarget.selectionStart === searchQuery.length
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  // The column shows the selected model's effort, so a highlighted model is picked
                  // first; the owning popup then moves focus to that model's levels.
                  const highlighted = highlightedModelKeyRef.current
                    ? parseModelPickerModelKey(highlightedModelKeyRef.current)
                    : null;
                  const pickedNew =
                    highlighted !== null &&
                    highlightedModelKeyRef.current !== activeModelKey &&
                    handleModelSelect(highlighted.slug, highlighted.instanceId) !== null;
                  if (!pickedNew) props.onFocusEffort();
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
                  if (subProviderSectionByKey.has(highlightedModelKeyRef.current)) {
                    toggleSubProviderSection(highlightedModelKeyRef.current);
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

            <ModelPickerList
              listRef={modelListRef}
              itemKeys={filteredItemKeys}
              extraData={modelListExtraData}
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
                      <span className="text-sm leading-snug text-muted-foreground group-hover:text-foreground group-data-highlighted:text-foreground">
                        {legacySection.isExpanded
                          ? gt("Show less", { $context: "collapses the list of older models" })
                          : gt("Show more", { $context: "expands the list of older models" })}
                      </span>
                    </ComboboxItem>
                  );
                }
                const subProviderSection = subProviderSectionByKey.get(modelKey);
                if (subProviderSection) {
                  const unavailable = subProviderSection.unavailableReason !== undefined;
                  return (
                    <ComboboxItem
                      hideIndicator
                      index={index}
                      value={modelKey}
                      disabled={unavailable}
                      aria-expanded={unavailable ? undefined : subProviderSection.isExpanded}
                      className="group w-full cursor-pointer"
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 truncate text-sm font-normal leading-snug">
                            {subProviderSection.name}
                          </div>
                          {unavailable ? (
                            <Badge variant="outline" size="sm">
                              {gt("Unavailable", { $context: "backend cannot be used right now" })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground">
                          {subProviderSection.unavailableReason ??
                            gt("{count, plural, one {{count} model} other {{count} models}}", {
                              count: subProviderSection.models.length,
                            })}
                        </div>
                      </div>
                      {unavailable ? null : (
                        <ChevronRightIcon
                          className={cn(
                            "size-4 shrink-0 transition-transform",
                            subProviderSection.isExpanded && "rotate-90",
                          )}
                        />
                      )}
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
                return (
                  <ModelListRow
                    key={modelKey}
                    index={index}
                    slug={model.slug}
                    name={model.name}
                    subProvider={model.subProvider}
                    instanceId={model.instanceId}
                    driverKind={model.driverKind}
                    providerDisplayName={model.instanceDisplayName}
                    acpRegistryAgentId={model.acpRegistryAgentId}
                    acpRegistryIconUrl={model.acpRegistryIconUrl}
                    isFavorite={isFavorite}
                    isSelected={isSelected}
                    favoriteStarOnHover={selectedDriverKind === "favorites" && !isSearching}
                    showNewBadge={model.badge === "new"}
                    unavailable={model.isUnavailable === true}
                    jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                    disabledReason={disabledReason}
                    onToggleFavorite={toggleFavorite}
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
            />
            <ModelPickerProviderNotices
              setupEntries={providerSetupEntries}
              updateRequiredNotices={updateRequiredNotices}
              emptyLabel={
                selectedDriverKind === "favorites" && !isSearching
                  ? gt("No favorites yet")
                  : workspaceModelsScanning
                    ? gt("Searching project models...")
                    : gt("No models found")
              }
              onRequestClose={props.onRequestClose}
              onOpenProviderSetup={props.onOpenProviderSetup}
            />
            {props.listFooter}
          </div>
        </Combobox>
      </div>
    </>
  );
});
