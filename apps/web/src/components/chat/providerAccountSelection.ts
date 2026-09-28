/**
 * Account is a separate composer dimension from model.
 *
 * The model picker lists one row per `(driverKind, slug)`. Choosing a model
 * resolves an instance for that driver; switching accounts happens in the
 * account picker when more than one enabled instance shares the driver.
 *
 * @module providerAccountSelection
 */
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { formatProviderDriverKindLabel } from "../../providerModels";
import { providerModelKey } from "../../modelOrdering";

export function providerBrandLabel(driverKind: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driverKind] ?? formatProviderDriverKindLabel(driverKind);
}

/**
 * Enabled instances of a driver that may serve the current thread.
 * Continuation-group locks keep Codex (and similar) homes from mixing.
 */
export function accountsForProvider(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly driverKind: ProviderDriverKind;
  readonly lockedContinuationGroupKey?: string | null | undefined;
}): ProviderInstanceEntry[] {
  return input.entries.filter(
    (entry) =>
      entry.driverKind === input.driverKind &&
      isProviderInstancePickerVisible(entry) &&
      (input.lockedContinuationGroupKey == null ||
        entry.continuationGroupKey === input.lockedContinuationGroupKey),
  );
}

/**
 * Pass the unlocked account list: a thread locked to one account still shows
 * the picker (read-only) so it is clear which account the thread runs on.
 */
export function shouldShowProviderAccountPicker(
  accounts: ReadonlyArray<ProviderInstanceEntry>,
): boolean {
  return accounts.length > 1;
}

/**
 * One rail entry per driver, preserving first-seen driver order. Prefers a
 * ready instance as the representative so a broken secondary account does not
 * hide a working one of the same provider.
 */
export function uniqueProviderRailEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry[] {
  const byDriver = new Map<ProviderDriverKind, ProviderInstanceEntry>();
  const order: ProviderDriverKind[] = [];
  for (const entry of entries) {
    const existing = byDriver.get(entry.driverKind);
    if (!existing) {
      byDriver.set(entry.driverKind, entry);
      order.push(entry.driverKind);
      continue;
    }
    if (!isProviderInstancePickerReady(existing) && isProviderInstancePickerReady(entry)) {
      byDriver.set(entry.driverKind, entry);
    }
  }
  return order.map((driverKind) => byDriver.get(driverKind)!);
}

export function resolveInstanceForModelSelection(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<{ readonly slug: string }>
  >;
  readonly driverKind: ProviderDriverKind;
  readonly slug: string;
  readonly preferredInstanceId?: ProviderInstanceId | null | undefined;
  readonly lockedContinuationGroupKey?: string | null | undefined;
}): ProviderInstanceId | undefined {
  const accounts = accountsForProvider({
    entries: input.entries,
    driverKind: input.driverKind,
    ...(input.lockedContinuationGroupKey != null
      ? { lockedContinuationGroupKey: input.lockedContinuationGroupKey }
      : {}),
  });
  if (accounts.length === 0) return undefined;

  const hasSlug = (instanceId: ProviderInstanceId) =>
    (input.modelOptionsByInstance.get(instanceId) ?? []).some(
      (option) => option.slug === input.slug,
    );

  if (input.preferredInstanceId) {
    const preferred = accounts.find((entry) => entry.instanceId === input.preferredInstanceId);
    if (preferred && hasSlug(preferred.instanceId)) {
      return preferred.instanceId;
    }
  }

  const defaultId = defaultInstanceIdForDriver(input.driverKind);
  const defaultAccount = accounts.find((entry) => entry.instanceId === defaultId);
  if (defaultAccount && hasSlug(defaultAccount.instanceId)) {
    return defaultAccount.instanceId;
  }

  const readyWithModel = accounts.find(
    (entry) => isProviderInstancePickerReady(entry) && hasSlug(entry.instanceId),
  );
  if (readyWithModel) return readyWithModel.instanceId;

  const anyWithModel = accounts.find((entry) => hasSlug(entry.instanceId));
  if (anyWithModel) return anyWithModel.instanceId;

  // Model missing from every catalog (legacy/unavailable selection): keep the
  // preferred account when it belongs to this driver, else the first account.
  if (input.preferredInstanceId) {
    const preferred = accounts.find((entry) => entry.instanceId === input.preferredInstanceId);
    if (preferred) return preferred.instanceId;
  }
  return accounts[0]?.instanceId;
}

/**
 * Collapse duplicate `(driverKind, slug)` rows, keeping the instance that
 * would be chosen if the user picked that model now.
 */
export function dedupeModelPickerItemsByDriverSlug<
  T extends {
    readonly instanceId: ProviderInstanceId;
    readonly driverKind: ProviderDriverKind;
    readonly slug: string;
  },
>(
  items: ReadonlyArray<T>,
  input: {
    readonly entries: ReadonlyArray<ProviderInstanceEntry>;
    readonly modelOptionsByInstance: ReadonlyMap<
      ProviderInstanceId,
      ReadonlyArray<{ readonly slug: string }>
    >;
    readonly preferredInstanceId?: ProviderInstanceId | null | undefined;
    readonly lockedContinuationGroupKey?: string | null | undefined;
  },
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = `${item.driverKind}\0${item.slug}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const preferred = resolveInstanceForModelSelection({
      entries: input.entries,
      modelOptionsByInstance: input.modelOptionsByInstance,
      driverKind: item.driverKind,
      slug: item.slug,
      ...(input.preferredInstanceId != null
        ? { preferredInstanceId: input.preferredInstanceId }
        : {}),
      ...(input.lockedContinuationGroupKey != null
        ? { lockedContinuationGroupKey: input.lockedContinuationGroupKey }
        : {}),
    });
    if (preferred === item.instanceId) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

/** True when any account of this driver has the model favorited. */
export function isDriverModelFavorite(input: {
  readonly favoritesSet: ReadonlySet<string>;
  readonly driverKind: ProviderDriverKind;
  readonly slug: string;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
}): boolean {
  for (const entry of input.entries) {
    if (entry.driverKind !== input.driverKind) continue;
    if (input.favoritesSet.has(providerModelKey(entry.instanceId, input.slug))) {
      return true;
    }
  }
  return false;
}

/**
 * Prefer keeping the current model on the destination account; otherwise use
 * that account's default (or first) model so the switch still lands somewhere
 * sendable.
 */
export function resolveModelForAccountSwitch(input: {
  readonly currentModel: string;
  readonly destinationModels: ReadonlyArray<{
    readonly slug: string;
    readonly isDefault?: boolean | undefined;
    readonly isCustom?: boolean | undefined;
    readonly isUnavailable?: boolean | undefined;
  }>;
}): string {
  const available = input.destinationModels.filter((model) => model.isUnavailable !== true);
  if (available.some((model) => model.slug === input.currentModel)) {
    return input.currentModel;
  }
  return (
    available.find((model) => model.isDefault && !model.isCustom)?.slug ??
    available.find((model) => !model.isCustom)?.slug ??
    available[0]?.slug ??
    input.currentModel
  );
}
