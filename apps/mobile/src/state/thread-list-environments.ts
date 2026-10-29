import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { threadGroupsShownInThreads, type ThreadGroups } from "@t3tools/contracts/settings";
import { Atom } from "effect/reactivity";

import { mergeThreadGroups } from "../features/threads/thread-groups";

export type ThreadListProvider = Pick<
  ServerProvider,
  "instanceId" | "driver" | "enabled" | "displayName" | "accentColor" | "iconUrl"
>;

const capabilityKeys = ["threadAutoSettleOptOut", "threadHiding", "threadGroups"] as const;

function selectEnvironment(config: ServerConfig) {
  return {
    providers: config.providers.map(
      ({ instanceId, driver, enabled, displayName, accentColor, iconUrl }) => ({
        instanceId,
        driver,
        enabled,
        displayName,
        accentColor,
        iconUrl,
      }),
    ),
    machineKind: resolveEnvironmentMachineKind(config),
    capabilities: config.environment.capabilities,
    threadGroups: config.settings.threadGroups,
    snoozePresets: config.settings.snoozePresets,
  };
}

type ListEnvironment = ReturnType<typeof selectEnvironment>;

function sameProviders(
  left: ReadonlyArray<ThreadListProvider>,
  right: ReadonlyArray<ThreadListProvider>,
) {
  return (
    left.length === right.length &&
    left.every((provider, index) => {
      const other = right[index]!;
      return (
        provider.instanceId === other.instanceId &&
        provider.driver === other.driver &&
        provider.enabled === other.enabled &&
        provider.displayName === other.displayName &&
        provider.accentColor === other.accentColor &&
        provider.iconUrl === other.iconUrl
      );
    })
  );
}

function sameShownGroups(left: ThreadGroups, right: ThreadGroups) {
  const shown = (groups: ThreadGroups) => [...threadGroupsShownInThreads(groups)].join("\0");
  return left === right || shown(left) === shown(right);
}

function collectEnvironments(environments: ReadonlyMap<EnvironmentId, ListEnvironment>) {
  const providersByEnvironmentId = new Map<EnvironmentId, ReadonlyArray<ThreadListProvider>>();
  const machineByEnvironmentId = new Map<EnvironmentId, EnvironmentMachineKind>();
  // Every protocol-2 server supports these thread actions; they only wait for its config.
  const loadedEnvironmentIds = new Set<EnvironmentId>();
  const autoSettleOptOutEnvironmentIds = new Set<EnvironmentId>();
  const hidingEnvironmentIds = new Set<EnvironmentId>();
  const groupEnvironmentIds = new Set<EnvironmentId>();
  const snoozePresetsByEnvironmentId = new Map<EnvironmentId, ListEnvironment["snoozePresets"]>();
  for (const [id, { providers, machineKind, capabilities, snoozePresets }] of environments) {
    providersByEnvironmentId.set(id, providers);
    snoozePresetsByEnvironmentId.set(id, snoozePresets);
    machineByEnvironmentId.set(id, machineKind);
    loadedEnvironmentIds.add(id);
    if (capabilities.threadAutoSettleOptOut === true) autoSettleOptOutEnvironmentIds.add(id);
    if (capabilities.threadHiding === true) hidingEnvironmentIds.add(id);
    if (capabilities.threadGroups === true) groupEnvironmentIds.add(id);
  }
  // Groups whose threads stay on the Threads, Snoozed and Settled pages as well as their own.
  const groupsShownInThreads = threadGroupsShownInThreads(
    mergeThreadGroups([...environments.values()].map((environment) => environment.threadGroups)),
  );
  return {
    providersByEnvironmentId,
    machineByEnvironmentId,
    settlementEnvironmentIds: loadedEnvironmentIds,
    snoozeEnvironmentIds: loadedEnvironmentIds,
    pinningEnvironmentIds: loadedEnvironmentIds,
    autoSettleOptOutEnvironmentIds,
    hidingEnvironmentIds,
    groupEnvironmentIds,
    groupsShownInThreads,
    pinReorderEnvironmentIds: loadedEnvironmentIds,
    activeReorderEnvironmentIds: loadedEnvironmentIds,
    titleRegenerationEnvironmentIds: loadedEnvironmentIds,
    snoozePresetsByEnvironmentId,
  };
}

export function createThreadListEnvironmentsAtom(
  configsAtom: Atom.Atom<ReadonlyMap<EnvironmentId, ServerConfig>>,
) {
  let previous = new Map<EnvironmentId, ListEnvironment>();
  let result = collectEnvironments(previous);
  return Atom.make((get) => {
    const configs = get(configsAtom);
    const next = new Map<EnvironmentId, ListEnvironment>();
    let changed = configs.size !== previous.size;
    for (const [id, config] of configs) {
      const selected = selectEnvironment(config);
      const prior = previous.get(id);
      if (prior && sameProviders(prior.providers, selected.providers)) {
        selected.providers = prior.providers;
      }
      if (prior && JSON.stringify(prior.snoozePresets) === JSON.stringify(selected.snoozePresets)) {
        selected.snoozePresets = prior.snoozePresets;
      }
      const unchanged =
        prior &&
        prior.providers === selected.providers &&
        prior.machineKind === selected.machineKind &&
        sameShownGroups(prior.threadGroups, selected.threadGroups) &&
        prior.snoozePresets === selected.snoozePresets &&
        capabilityKeys.every(
          (key) => (prior.capabilities[key] === true) === (selected.capabilities[key] === true),
        );
      next.set(id, unchanged ? prior : selected);
      if (!unchanged) changed = true;
    }
    if (changed) {
      previous = next;
      result = collectEnvironments(next);
    }
    return result;
  }).pipe(Atom.withLabel("thread-list-environments"));
}
